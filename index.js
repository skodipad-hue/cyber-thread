// Load .env ONLY for local development
if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

const express = require("express");
const mysql = require("mysql2");
const multer = require("multer");
const fs = require("fs");
const methodOverride = require("method-override");
const ImageKit = require("imagekit");
const { v4: uuidv4 } = require("uuid");
const path = require("path");

const app = express();

/* ================= MIDDLEWARE ================= */
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride("_method"));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

const upload = multer({ dest: "uploads/" });

/* ================= IMAGEKIT ================= */
const imagekit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
});

/* ================= DATABASE (POOL) ================= */
const db = mysql.createPool({
  uri: process.env.DATABASE_URL,
  waitForConnections: true,
  connectionLimit: 5,
  enableKeepAlive: true,
});

db.query("SELECT 1", (err) => {
  if (err) {
    console.error("❌ MySQL error:", err);
    process.exit(1);
  }
  console.log("✅ MySQL connected (Railway)");
});

/* ================= HELPERS ================= */
function timeAgo(date) {
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

/* ================= LOGIN ================= */
app.get("/", (req, res) => res.redirect("/login"));
app.get("/login", (req, res) => res.render("loginPage"));

app.post("/login", (req, res) => {
  const { email, password } = req.body;
  db.query(
    "SELECT * FROM users WHERE email=? AND password=?",
    [email, password],
    (err, users) => {
      if (err || !users.length) return res.send("Invalid login");
      res.redirect(`/users/${users[0].id}/posts`);
    }
  );
});

/* ================= REGISTER ================= */
app.get("/new-guy-page", (req, res) => res.render("register"));

app.post("/register", (req, res) => {
  const { username, email, password } = req.body;
  db.query(
    "INSERT INTO users (username, email, password) VALUES (?, ?, ?)",
    [username, email, password],
    (err) => {
      if (err) return res.send(err.sqlMessage);
      res.redirect("/login");
    }
  );
});

/* ================= FEED ================= */
app.get("/users/:id/posts", (req, res) => {
  const userId = req.params.id;
  db.query(
    `SELECT posts.*, users.username
     FROM posts JOIN users ON posts.user_id = users.id
     ORDER BY posts.created_at DESC`,
    (err, posts) => {
      posts.forEach(p => p.timeAgo = timeAgo(p.created_at));
      res.render("feed", { posts, userId });
    }
  );
});

/* ================= CREATE POST ================= */
app.post("/users/:id/posts", upload.single("image"), async (req, res) => {
  const postId = uuidv4();
  const userId = req.params.id;
  let url = null;

  if (req.file) {
    const data = fs.readFileSync(req.file.path);
    const uploaded = await imagekit.upload({
      file: data,
      fileName: req.file.originalname,
    });
    fs.unlinkSync(req.file.path);
    url = uploaded.url;
  }

  db.query(
    "INSERT INTO posts (id, user_id, content, url) VALUES (?, ?, ?, ?)",
    [postId, userId, req.body.content, url],
    () => res.redirect(`/profile/${userId}`)
  );
});

/* ================= PROFILE ================= */
app.get("/profile/:id", (req, res) => {
  const id = req.params.id;
  db.query("SELECT * FROM users WHERE id=?", [id], (err, users) => {
    const user = users[0];
    db.query(
      "SELECT * FROM posts WHERE user_id=? ORDER BY created_at DESC",
      [id],
      (err, posts) => {
        posts.forEach(p => p.timeAgo = timeAgo(p.created_at));
        res.render("profile", { user, posts });
      }
    );
  });
});

/* ================= UPDATE BIO (🔥 FIX) ================= */
app.post("/profile/:id", (req, res) => {
  const userId = req.params.id;
  const { bio } = req.body;

  db.query(
    "UPDATE users SET bio=? WHERE id=?",
    [bio, userId],
    () => res.redirect(`/profile/${userId}`)
  );
});

/* ================= START SERVER ================= */
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Server running on ${PORT}`));
