// Load env only in development
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

/* ================= IMAGEKIT (PROFILE ONLY) ================= */
const imagekit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
});

/* ================= DATABASE ================= */
const db = mysql.createPool({
  uri: process.env.DATABASE_URL,
  waitForConnections: true,
  connectionLimit: 5,
});

db.query("SELECT 1", (err) => {
  if (err) {
    console.error("❌ MySQL error:", err);
    process.exit(1);
  }
  console.log("✅ MySQL connected");
});

/* ================= HELPERS ================= */
function timeAgo(date) {
  if (!date) return "just now";

  const postTime = new Date(
    typeof date === "string" ? date.replace(" ", "T") : date
  );

  if (isNaN(postTime.getTime())) return "just now";

  let seconds = Math.floor((Date.now() - postTime.getTime()) / 1000);
  if (seconds < 0) seconds = Math.abs(seconds);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes !== 1 ? "s" : ""} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours !== 1 ? "s" : ""} ago`;

  const days = Math.floor(hours / 24);
  return `${days} day${days !== 1 ? "s" : ""} ago`;
}

/* ================= AUTH ================= */
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
     FROM posts
     JOIN users ON posts.user_id = users.id
     ORDER BY posts.created_at DESC`,
    (err, posts) => {
      if (err) return res.status(500).send("Database error");

      posts.forEach(p => p.timeAgo = timeAgo(p.created_at));
      res.render("feed", { posts, userId });
    }
  );
});

/* ================= CREATE POST (TEXT ONLY) ================= */
app.post("/users/:id/posts", (req, res) => {
  const postId = uuidv4();
  const userId = req.params.id;
  const createdAt = new Date();

  db.query(
    "INSERT INTO posts (id, user_id, content, created_at) VALUES (?, ?, ?, ?)",
    [postId, userId, req.body.content, createdAt],
    () => res.redirect(`/users/${userId}/posts`)
  );
});

/* ================= PROFILE ================= */
app.get("/profile/:id", (req, res) => {
  const userId = req.params.id;

  db.query(
    "SELECT id, username, email, bio, profile_url FROM users WHERE id=?",
    [userId],
    (err, users) => {
      if (err || !users.length) return res.status(404).send("User not found");

      const user = users[0];

      db.query(
        "SELECT * FROM posts WHERE user_id=? ORDER BY created_at DESC",
        [userId],
        (err, posts) => {
          posts.forEach(p => p.timeAgo = timeAgo(p.created_at));
          res.render("profile", { user, posts });
        }
      );
    }
  );
});

/* ================= UPDATE BIO ================= */
app.post("/profile/:id", (req, res) => {
  db.query(
    "UPDATE users SET bio=? WHERE id=?",
    [req.body.bio, req.params.id],
    () => res.redirect(`/profile/${req.params.id}`)
  );
});

/* ================= EDIT POST ================= */
app.put("/posts/:id", (req, res) => {
  const { content, userId } = req.body;

  db.query(
    "UPDATE posts SET content=? WHERE id=?",
    [content, req.params.id],
    () => res.redirect(`/users/${userId}/posts`)
  );
});

/* ================= DELETE POST ================= */
app.delete("/posts/:id", (req, res) => {
  const { userId } = req.body;

  db.query(
    "DELETE FROM posts WHERE id=?",
    [req.params.id],
    () => res.redirect(`/users/${userId}/posts`)
  );
});

/* ================= POST DETAILS ================= */
app.get("/posts/:id", (req, res) => {
  db.query(
    `SELECT posts.*, users.username, users.profile_url
     FROM posts
     JOIN users ON posts.user_id = users.id
     WHERE posts.id = ?
     LIMIT 1`,
    [req.params.id],
    (err, rows) => {
      if (err || !rows.length) return res.status(404).send("Post not found");

      const post = rows[0];
      post.timeAgo = timeAgo(post.created_at);
      res.render("postDetails", { post });
    }
  );
});

/* ================= UPDATE PROFILE PHOTO ================= */
app.post("/profile/:id/photo", upload.single("profileImage"), async (req, res) => {
  if (!req.file) return res.redirect(`/profile/${req.params.id}`);

  try {
    const data = fs.readFileSync(req.file.path);
    const uploaded = await imagekit.upload({
      file: data,
      fileName: req.file.originalname,
      folder: "profile_photos",
    });

    fs.unlinkSync(req.file.path);

    db.query(
      "UPDATE users SET profile_url=? WHERE id=?",
      [uploaded.url, req.params.id],
      () => res.redirect(`/profile/${req.params.id}`)
    );
  } catch (err) {
    console.error(err);
    res.redirect(`/profile/${req.params.id}`);
  }
});

/* ================= START SERVER ================= */
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
