(function () {
  const API_BASE_URL = "http://localhost:4000/api";
  const TOKEN_KEY = "medconnect_token";
  const USER_KEY = "medconnect_user";

  window.AppApi = {
    baseUrl: API_BASE_URL,
    getToken() {
      return localStorage.getItem(TOKEN_KEY) || "";
    },
    setAuth(token, user) {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(user || {}));
    },
    clearAuth() {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    },
    getUser() {
      const raw = localStorage.getItem(USER_KEY);
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch (_error) {
        return null;
      }
    },
    async request(path, options) {
      const opts = options || {};
      const headers = Object.assign(
        { "Content-Type": "application/json" },
        opts.headers || {}
      );
      const token = this.getToken();
      if (token) {
        headers.Authorization = "Bearer " + token;
      }

      let response;
      try {
        response = await fetch(this.baseUrl + path, Object.assign({}, opts, { headers }));
      } catch (_error) {
        throw new Error("Backend is not running. Start it with: cd backend; npm start");
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = data.message || "Request failed.";
        const error = new Error(message);
        error.status = response.status;
        throw error;
      }
      return data;
    }
  };

  const footer = document.querySelector(".site-footer");
  if (footer && !footer.querySelector(".footer-inner")) {
    footer.innerHTML = `
      <div class="footer-inner">
        <div class="footer-links">
          <a href="project.html">Home</a>
          <a href="app.html">Appointments</a>
          <a href="art.html">Articles</a>
          <a href="contact.html">Contact</a>
        </div>
        <p>&copy; <span id="currentYear"></span> MedConnect</p>
        <div class="footer-social" aria-label="Social links">
          <a href="#" aria-label="Instagram">IG</a>
          <a href="#" aria-label="LinkedIn">IN</a>
          <a href="#" aria-label="YouTube">YT</a>
        </div>
      </div>
    `;
  }

  const yearNode = document.getElementById("currentYear");
  if (yearNode) {
    yearNode.textContent = String(new Date().getFullYear());
  }

  const page = location.pathname.split("/").pop() || "project.html";
  const activePage = page === "read_article.html" ? "art.html" : page;
  document.querySelectorAll(".site-nav a").forEach((link) => {
    const href = link.getAttribute("href");
    if (href === activePage) {
      link.classList.add("active");
    }
  });

  const user = window.AppApi.getUser();
  const token = window.AppApi.getToken();
  const authCta = document.querySelector(".auth-cta");
  if (authCta && user && token) {
    authCta.textContent = "Logout";
    authCta.href = "#";
    authCta.addEventListener("click", async (event) => {
      event.preventDefault();
      try {
        await window.AppApi.request("/auth/logout", { method: "POST" });
      } catch (_error) {
        // Local logout should still work if the backend is unavailable.
      }
      window.AppApi.clearAuth();
      window.location.href = "project.html";
    });
  }
  const headerInner = document.querySelector(".header-inner");
  if (headerInner && user && (user.firstName || user.username)) {
    let welcome = headerInner.querySelector(".welcome-user");
    if (!welcome) {
      welcome = document.createElement("p");
      welcome.className = "welcome-user";
      headerInner.appendChild(welcome);
    }
    const displayName = user.firstName || user.username || "User";
    welcome.textContent = `Welcome back ${displayName}!`;
  }

  const slider = document.getElementById("adviceSlider");
  if (slider) {
    const slides = Array.from(slider.querySelectorAll(".advice-slide"));
    const dotsContainer = document.getElementById("adviceDots");
    if (dotsContainer) {
      dotsContainer.innerHTML = slides
        .map(
          (_, index) =>
            `<button type="button" class="advice-dot${
              index === 0 ? " active" : ""
            }" data-index="${index}" aria-label="Show advice ${index + 1}"></button>`
        )
        .join("");
    }
    const dots = dotsContainer
      ? Array.from(dotsContainer.querySelectorAll(".advice-dot"))
      : [];
    let currentIndex = 0;

    const setSlide = (index) => {
      currentIndex = index;
      slides.forEach((slide, i) => {
        slide.classList.toggle("active", i === currentIndex);
      });
      dots.forEach((dot, i) => {
        dot.classList.toggle("active", i === currentIndex);
      });
    };

    const nextSlide = () => {
      const nextIndex = (currentIndex + 1) % slides.length;
      setSlide(nextIndex);
    };

    slider.addEventListener("mouseenter", nextSlide);

    dots.forEach((dot) => {
      dot.addEventListener("click", () => {
        const index = Number(dot.getAttribute("data-index"));
        setSlide(index);
      });
    });

    setSlide(0);
  }
})();

function showFeedback(elementId, type, text) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.className = "feedback " + type;
  el.textContent = text;
}
