import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { XMLParser } from "fast-xml-parser";
import Groq from "groq-sdk";
import jwt from "jsonwebtoken";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_PATH = path.join(__dirname, "data", "store.json");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const app = express();
const PORT = process.env.PORT || 4000;
const PASSWORD_PATTERN = /^(?=.*[0-9])(?=.*[^A-Za-z0-9\s]).{8,}$/;
const JWT_SECRET = process.env.JWT_SECRET || "dev-only-change-this-secret";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "2h";
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const groq = process.env.GROQ_API_KEY
  ? new Groq({ apiKey: process.env.GROQ_API_KEY })
  : null;
const CHAT_SYSTEM_PROMPT = `You are the MedConnect assistant. Give clear, concise, supportive guidance about navigating the website, appointments, medical specializations, wellness, and general health information.

Medical safety rules:
- Do not diagnose, prescribe medication, or claim to replace a qualified clinician.
- For symptoms, explain sensible next steps and which type of clinician may be appropriate.
- If the user describes a possible emergency (such as severe chest pain, trouble breathing, stroke signs, severe bleeding, loss of consciousness, or immediate self-harm risk), tell them to contact local emergency services or go to the nearest emergency department immediately.
- Encourage professional care when symptoms are severe, persistent, worsening, or uncertain.
- Never invent doctors, appointment availability, test results, or information about this website.
- Keep most answers under 180 words and ask at most one useful follow-up question.`;
const MEDLINEPLUS_CACHE_MS = 12 * 60 * 60 * 1000;
const MEDLINEPLUS_TIMEOUT_MS = 20000;
const MEDLINEPLUS_MAX_ATTEMPTS = 2;
const MEDLINEPLUS_QUERIES = {
  general: "general health",
  cardiology: "heart diseases",
  dermatology: "skin diseases",
  gastroenterology: "digestive system diseases",
  neurology: "neurologic diseases",
  orthopedics: "bone joint injuries",
  pediatrics: "children health",
  nutrition: "nutrition"
};
const medlinePlusCache = new Map();
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true
});
const DEFAULT_ARTICLE_CATEGORIES = [
  { id: "general", name: "General Medicine" },
  { id: "cardiology", name: "Cardiology" },
  { id: "dermatology", name: "Dermatology" },
  { id: "gastroenterology", name: "Gastroenterology" },
  { id: "neurology", name: "Neurology" },
  { id: "orthopedics", name: "Orthopedics" },
  { id: "pediatrics", name: "Pediatrics" },
  { id: "nutrition", name: "Nutrition" }
];

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "..")));

function readStore() {
  if (!existsSync(DATA_PATH)) {
    const empty = {
      users: [],
      specializations: [],
      doctors: [],
      appointments: [],
      articles: [],
      chats: []
    };
    writeStore(empty);
    return empty;
  }

  const store = JSON.parse(readFileSync(DATA_PATH, "utf-8"));
  let updated = false;

  if (Array.isArray(store.users)) {
    store.users = store.users.map((user) => {
      if (user.passwordHash) return user;
      if (user.password) {
        updated = true;
        const passwordHash = bcrypt.hashSync(String(user.password), 10);
        const migratedUser = { ...user, passwordHash };
        delete migratedUser.password;
        return migratedUser;
      }
      return user;
    });
  }

  if (!Array.isArray(store.articleCategories) || !store.articleCategories.length) {
    store.articleCategories = [...DEFAULT_ARTICLE_CATEGORIES];
    updated = true;
  }

  if (Array.isArray(store.articles)) {
    store.articles = store.articles.map((article) => {
      if (article.category) return article;
      updated = true;
      return { ...article, category: "general" };
    });
  }

  if (updated) {
    writeStore(store);
  }

  return store;
}

function writeStore(data) {
  writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

function publicUser(user) {
  const { password, passwordHash, ...safeUser } = user;
  return safeUser;
}

function xmlText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(xmlText).join(" ");
  return Object.entries(value)
    .filter(([key]) => !key.startsWith("@_"))
    .map(([, child]) => xmlText(child))
    .join(" ");
}

function cleanSummary(value, maxLength = 520) {
  const text = xmlText(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).replace(/\s+\S*$/, "")}...`;
}

async function requestMedlinePlus(url) {
  let lastError;

  for (let attempt = 1; attempt <= MEDLINEPLUS_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(MEDLINEPLUS_TIMEOUT_MS)
      });
      if (response.ok) return response;
      lastError = new Error(`MedlinePlus returned ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("MedlinePlus did not respond.");
}

async function fetchMedlinePlusArticles(category) {
  const cached = medlinePlusCache.get(category);
  if (cached && Date.now() - cached.savedAt < MEDLINEPLUS_CACHE_MS) {
    return cached.articles;
  }

  const term = MEDLINEPLUS_QUERIES[category];
  if (!term) return [];

  const params = new URLSearchParams({
    db: "healthTopics",
    term,
    rettype: "brief",
    retmax: "6",
    tool: "medconnect"
  });
  const response = await requestMedlinePlus(`https://wsearch.nlm.nih.gov/ws/query?${params}`);

  const parsed = xmlParser.parse(await response.text());
  const documents = parsed?.nlmSearchResult?.list?.document;
  const list = Array.isArray(documents) ? documents : documents ? [documents] : [];
  const articles = list.map((document, index) => {
    const contents = Array.isArray(document.content)
      ? document.content
      : document.content
        ? [document.content]
        : [];
    const findContent = (name) => contents.find(
      (item) => String(item?.["@_name"] || "").toLowerCase() === name.toLowerCase()
    );
    const title = cleanSummary(findContent("title"), 160);
    const summary = cleanSummary(
      findContent("FullSummary") || findContent("snippet"),
      520
    );

    return {
      id: `medlineplus-${category}-${index}-${document["@_rank"] || 0}`,
      title: title || "MedlinePlus Health Topic",
      content: summary || "Open this topic on MedlinePlus to learn more.",
      category,
      author: "MedlinePlus, National Library of Medicine",
      url: document["@_url"],
      external: true
    };
  }).filter((article) => article.url);

  medlinePlusCache.set(category, { savedAt: Date.now(), articles });
  return articles;
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    return res.status(401).json({ message: "Authorization token missing." });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.sub;
    const store = readStore();
    const user = store.users.find((u) => u.id === userId);
    if (!user) {
      return res.status(401).json({ message: "User not found for token." });
    }

    req.user = user;
    req.token = token;
    return next();
  } catch (_error) {
    return res.status(401).json({ message: "Invalid or expired token." });
  }
}

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "medconnect-backend" });
});

app.post("/api/auth/register", (req, res) => {
  const { firstName, lastName, dob, place, email, username, password } = req.body;
  if (!firstName || !lastName || !dob || !place || !email || !username || !password) {
    return res.status(400).json({ message: "All registration fields are required." });
  }

  if (!PASSWORD_PATTERN.test(String(password))) {
    return res.status(400).json({
      message: "Password must be at least 8 characters and include at least one number and one special character."
    });
  }

  const store = readStore();
  const exists = store.users.some(
    (u) => u.username.toLowerCase() === String(username).toLowerCase() || u.email.toLowerCase() === String(email).toLowerCase()
  );

  if (exists) {
    return res.status(409).json({ message: "Username or email already exists." });
  }

  const user = {
    id: randomUUID(),
    firstName,
    lastName,
    dob,
    place,
    email,
    username,
    passwordHash: bcrypt.hashSync(String(password), 10)
  };

  store.users.push(user);
  writeStore(store);

  return res.status(201).json({ message: "Registration successful.", user: publicUser(user) });
});

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ message: "Username and password are required." });
  }

  const store = readStore();
  const user = store.users.find(
    (u) => u.username.toLowerCase() === String(username).toLowerCase()
  );

  if (!user || !user.passwordHash || !bcrypt.compareSync(String(password), user.passwordHash)) {
    return res.status(401).json({ message: "Invalid username or password." });
  }

  const token = jwt.sign({ sub: user.id, username: user.username }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN
  });

  return res.json({
    message: "Login successful.",
    token,
    expiresIn: JWT_EXPIRES_IN,
    user: publicUser(user)
  });
});

app.get("/api/auth/me", authRequired, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.post("/api/auth/logout", authRequired, (req, res) => {
  res.json({ message: "Logged out. Remove token on client side." });
});

app.get("/api/specializations", (_req, res) => {
  const store = readStore();
  res.json({ specializations: store.specializations });
});

app.get("/api/doctors", (req, res) => {
  const { specialization } = req.query;
  const store = readStore();
  const doctors = specialization
    ? store.doctors.filter((doc) => doc.specialization === specialization)
    : store.doctors;
  res.json({ doctors });
});

app.post("/api/appointments", authRequired, (req, res) => {
  const { name, date, time, place, specialization, doctor } = req.body;
  if (!name || !date || !time || !place || !specialization || !doctor) {
    return res.status(400).json({ message: "All appointment fields are required." });
  }

  const store = readStore();
  const appointment = {
    id: randomUUID(),
    userId: req.user.id,
    name,
    date,
    time,
    place,
    specialization,
    doctor,
    status: "Confirmed",
    createdAt: new Date().toISOString()
  };

  store.appointments.push(appointment);
  writeStore(store);

  res.status(201).json({ message: "Appointment confirmed.", appointment });
});

app.get("/api/appointments/me", authRequired, (req, res) => {
  const store = readStore();
  const appointments = store.appointments.filter((a) => a.userId === req.user.id);
  res.json({ appointments });
});

app.get("/api/medical-articles", async (req, res) => {
  const category = String(req.query.category || "all").toLowerCase();
  if (category !== "all" && !MEDLINEPLUS_QUERIES[category]) {
    return res.status(400).json({ message: "Invalid article category." });
  }

  try {
    if (category !== "all") {
      const articles = await fetchMedlinePlusArticles(category);
      return res.json({ articles });
    }

    const results = await Promise.allSettled(
      Object.keys(MEDLINEPLUS_QUERIES).map(fetchMedlinePlusArticles)
    );
    const articles = results.flatMap((result) =>
      result.status === "fulfilled" ? result.value.slice(0, 2) : []
    );

    if (!articles.length) {
      throw new Error("No MedlinePlus categories could be loaded.");
    }

    return res.json({ articles });
  } catch (error) {
    console.error("MedlinePlus request failed:", error?.message || error);
    return res.status(502).json({
      message: "MedlinePlus articles are temporarily unavailable."
    });
  }
});

app.get("/api/articles", (_req, res) => {
  const { category } = _req.query;
  const store = readStore();
  let articles = [...store.articles];
  if (category && category !== "all") {
    articles = articles.filter((item) => item.category === category);
  }
  const sorted = articles.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ articles: sorted });
});

app.get("/api/article-categories", (_req, res) => {
  const store = readStore();
  res.json({ categories: store.articleCategories || DEFAULT_ARTICLE_CATEGORIES });
});

app.post("/api/articles", authRequired, (req, res) => {
  const { title, content, category } = req.body;
  if (!title || !content || !category) {
    return res.status(400).json({ message: "Title, content, and category are required." });
  }

  const store = readStore();
  const validCategory = (store.articleCategories || DEFAULT_ARTICLE_CATEGORIES).some(
    (item) => item.id === category
  );
  if (!validCategory) {
    return res.status(400).json({ message: "Invalid article category." });
  }

  const article = {
    id: randomUUID(),
    title,
    content,
    category,
    authorId: req.user.id,
    author: `${req.user.firstName} ${req.user.lastName}`,
    createdAt: new Date().toISOString()
  };

  store.articles.push(article);
  writeStore(store);

  res.status(201).json({ message: "Article created.", article });
});

app.post("/api/chat", authRequired, async (req, res) => {
  const { message } = req.body;
  if (!message || !String(message).trim()) {
    return res.status(400).json({ message: "Message is required." });
  }

  if (!groq) {
    return res.status(503).json({
      message: "AI chat is not configured. Add GROQ_API_KEY to backend/.env and restart the server."
    });
  }

  const cleanMessage = String(message).trim().slice(0, 4000);

  try {
    const store = readStore();
    const recentChats = (store.chats || [])
      .filter((chat) => chat.userId === req.user.id)
      .slice(-6);
    const history = recentChats.flatMap((chat) => [
      { role: "user", content: String(chat.message) },
      { role: "assistant", content: String(chat.response) }
    ]);
    const completion = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: CHAT_SYSTEM_PROMPT },
        ...history,
        { role: "user", content: cleanMessage }
      ],
      temperature: 0.4,
      max_completion_tokens: 500
    });
    const response = completion.choices[0]?.message?.content?.trim();

    if (!response) {
      throw new Error("The AI provider returned an empty response.");
    }

    store.chats = store.chats || [];
    store.chats.push({
      id: randomUUID(),
      userId: req.user.id,
      message: cleanMessage,
      response,
      createdAt: new Date().toISOString()
    });
    writeStore(store);

    return res.json({ reply: response });
  } catch (error) {
    console.error("Groq chat request failed:", error?.message || error);
    return res.status(502).json({
      message: "The AI assistant is temporarily unavailable. Please try again shortly."
    });
  }
});

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
