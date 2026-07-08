# 🩺 MedConnect

**An AI-powered full-stack healthcare web application that enables users to discover specialists, book appointments, access trusted medical articles, and interact with an intelligent healthcare assistant.**



##  Features

-  Secure user authentication using JWT
-  AI Healthcare Assistant powered by Groq API
-  Medical articles fetched using the MedlinePlus API
-  Specialist recommendation based on symptoms
-  Appointment booking and management
-  Responsive and user-friendly interface
-  RESTful backend APIs built with Express.js



## Tech Stack

 Frontend
- HTML5
- CSS3
- JavaScript

 Backend
- Node.js
- Express.js

 Authentication
- JWT (JSON Web Token)

 APIs
- Groq API
- MedlinePlus API

 Data Storage
- JSON-based storage



##  Project Structure

```
MedConnect
│
├── assets/
│   ├── css/
│   └── js/
│
├── backend/
│   ├── src/
│   │   ├── server.js
│   │   └── data/
│   │       └── store.json
│   ├── package.json
│   └── .env.example
│
├── index.html
├── login.html
├── ai.html
├── app.html
├── art.html
├── doc.html
├── contact.html
└── ...
```



##  Installation

 Clone the repository

```bash
git clone https://github.com/jsid135/MedConnect.git
```

 Navigate to the backend

```bash
cd backend
```

 Install dependencies

```bash
npm install
```

 Create a `.env` file

```env
GROQ_API_KEY=your_groq_api_key
JWT_SECRET=your_jwt_secret
JWT_EXPIRES_IN=2h
PORT=3000
```

 Start the server

```bash
npm start
```


## Screenshots

> Screenshots will be added soon.

- Home Page
- AI Assistant
- Appointment Booking
- Articles
- Specialist Finder



##  Future Enhancements

- Database integration (PostgreSQL/MongoDB)
- Email appointment confirmations
- Admin dashboard
- Doctor portal
- Medical history tracking
- Deployment on Render



##  Author

**Janie M S**

Final-year Computer Science Engineering (Bioinformatics) student at VIT Vellore.

Interested in AI Applications, Full-Stack Development, and Software Engineering.
