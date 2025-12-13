require("dotenv").config();
const express = require("express");
const mysql = require("mysql2");
const multer = require("multer");
const fs = require("fs");
const methodOverride = require("method-override");
const ImageKit = require("imagekit");
const { v4: uuidv4 } = require("uuid");
const path = require("path");

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(methodOverride("_method"));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

const upload = multer({ dest: "uploads/" });

// ImageKit
const imagekit = new ImageKit({
    publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
    privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
    urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT
});

// DB
const db = mysql.createConnection({
    host: "localhost",
    user: "root",
    database: "delta_app",
    password: "saif_2005"
});

// TIME AGO
function timeAgo(date) {
    let seconds = Math.floor((new Date() - new Date(date)) / 1000);
    if (seconds < 60) return "just now";
    let minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    let hours = Math.floor(minutes / 60);
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
        (err, user) => {
            if (!user.length) return res.send("Invalid Login");
            res.redirect(`/users/${user[0].id}/posts`);
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
        err => {
            if (err) return res.send("Email already exists");
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
            posts.forEach(p => (p.timeAgo = timeAgo(p.created_at)));
            res.render("feed", { posts, userId });
        }
    );
});

/* ================= POST DETAILS PAGE ================= */
app.get("/posts/:id", (req, res) => {
    const postId = req.params.id;

    db.query(
        `SELECT posts.*, users.username, users.email, users.bio, users.created_at AS joined
         FROM posts 
         JOIN users ON posts.user_id = users.id
         WHERE posts.id=?`,
        [postId],
        (err, rows) => {
            if (!rows.length) return res.send("Post not found.");
            const post = rows[0];
            post.timeAgo = timeAgo(post.created_at);
            res.render("postdetails", { post });
        }
    );
});

/* ================= CREATE POST ================= */
app.post("/users/:id/posts", upload.single("image"), async (req, res) => {
    const userId = req.params.id;
    const postId = uuidv4();
    let url = null;

    if (req.file) {
        const fileData = fs.readFileSync(req.file.path);
        const uploaded = await imagekit.upload({
            file: fileData,
            fileName: req.file.originalname
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

/* ================= DELETE POST → ALWAYS GO BACK TO FEED ================= */
app.delete("/posts/:id", (req, res) => {
    const { id } = req.params;
    const { userId } = req.body;

    db.query("DELETE FROM posts WHERE id=?", [id], () => {
        res.redirect(`/users/${userId}/posts`);
    });
});

/* ================= EDIT POST ================= */
app.put("/posts/:id", (req, res) => {
    const { id } = req.params;
    const { content, userId } = req.body;

    db.query(
        "UPDATE posts SET content=? WHERE id=?",
        [content, id],
        () => res.redirect(`/users/${userId}/posts`)
    );
});

/* ================= PROFILE PAGE ================= */
app.get("/profile/:id", (req, res) => {
    const id = req.params.id;

    db.query("SELECT * FROM users WHERE id=?", [id], (err, users) => {
        let user = users[0];

        db.query(
            "SELECT * FROM posts WHERE user_id=? ORDER BY created_at DESC",
            [id],
            (err, posts) => {
                posts.forEach(p => (p.timeAgo = timeAgo(p.created_at)));
                res.render("profile", { user, posts });
            }
        );
    });
});

/* ================= UPDATE BIO ================= */
app.post("/profile/:id", (req, res) => {
    db.query(
        "UPDATE users SET bio=? WHERE id=?",
        [req.body.bio, req.params.id],
        () => res.redirect(`/profile/${req.params.id}`)
    );
});

app.listen(8080, () => console.log("Server running on 8080"));
