// smtp_email_marketing_app/index.js

const express = require("express");
const bodyParser = require("body-parser");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const nodemailer = require("nodemailer");
const csv = require("csv-parser");
const net = require("net");
const jwt = require("jsonwebtoken");
const cors = require("cors");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const upload = multer({ dest: "uploads/" });

let emailQueue = [];
let sending = false;
let sendLogs = [];
let transporter = null;
let openTracker = {};

app.use(cors({origin: "https://email-template-front-end.vercel.app/",
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));
app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Dummy auth
const admin = { username: "admin", password: "admin123" };
const SECRET = "supersecret";

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (username === admin.username && password === admin.password) {
    const token = jwt.sign({ username }, SECRET, { expiresIn: "1h" });
    return res.json({ token });
  }
  res.status(401).send("Invalid credentials");
});

app.post("/setup", verifyToken, (req, res) => {
  const { host, port, user, pass, fromName } = req.body;
  process.env.EMAIL_USER = user;
  process.env.EMAIL_PASS = pass;
  process.env.FROM_NAME = fromName;

  transporter = nodemailer.createTransport({
    host,
    port: parseInt(port),
    secure: port == 465,
    auth: { user, pass },
  });

  res.send("SMTP configured successfully.");
});

app.post("/upload", verifyToken, upload.single("file"), (req, res) => {
  const results = [];
  fs.createReadStream(req.file.path)
    .pipe(csv())
    .on("data", (data) => results.push(data))
    .on("end", () => {
      emailQueue = results;
      res.send("Emails uploaded successfully.");
    });
});

 

app.get("/start", verifyToken, (req, res) => {
  if (sending) return res.send("Already running.");
  if (!transporter) return res.send("SMTP not configured.");
  if (emailQueue.length === 0) return res.send("No emails in queue.");

  sending = true;
  processEmails();
  res.send("Campaign started.");
});

app.get("/stop", verifyToken, (req, res) => {
  sending = false;
  res.send("Campaign stopped.");
});

app.get("/report", verifyToken, (req, res) => {
  const enhancedLogs = sendLogs.map(log => {
    const opened = openTracker[log.messageId] || false;
    return { ...log, opened };
  });
  res.json(enhancedLogs);
});

app.get("/port-check", (req, res) => {
  const client = net.createConnection({ host: "smtp.gmail.com", port: 25 }, () => {
    res.send("Port 25 is open");
    client.end();
  });
  client.on("error", () => res.send("Port 25 is blocked"));
});

app.get("/open/:id", (req, res) => {
  const id = req.params.id;
  openTracker[id] = true;
  res.sendFile(path.join(__dirname, "public", "pixel.png"));
});

function processEmails() {
  if (!sending || emailQueue.length === 0) return;

  const batch = emailQueue.splice(0, 20);
  batch.forEach((email) => {
    const { To, Subject, Body, BCC, CC, ReplyTo } = email;
    const messageId = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;

    const bodyWithTracking = `${Body}<img src='http://localhost:${PORT}/open/${messageId}' width='1' height='1' style='display:none' />`;

    transporter.sendMail({
      from: `\"${process.env.FROM_NAME}\" <${process.env.EMAIL_USER}>`,
      to: To,
      subject: Subject,
      html: bodyWithTracking,
      bcc: BCC,
      cc: CC,
      replyTo: ReplyTo,
    }, (err, info) => {
      sendLogs.push({
        to: To,
        subject: Subject,
        status: err ? "Failed" : "Sent",
        messageId,
        error: err?.message || "",
        time: new Date(),
      });
    });
  });

  const randomDelay = Math.floor(Math.random() * 60000) + 60000; // 1-2 mins
  setTimeout(() => processEmails(), randomDelay);
}

function verifyToken(req, res, next) {
  const token = req.headers["authorization"];
  if (!token) return res.status(403).send("No token provided");

  jwt.verify(token, SECRET, (err, decoded) => {
    if (err) return res.status(500).send("Failed to authenticate token");
    req.user = decoded;
    next();
  });
}

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

