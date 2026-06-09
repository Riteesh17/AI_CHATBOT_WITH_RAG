const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const authMiddleware = require("../middleware/auth");
const { getPool } = require("../config/db");

const router = express.Router();
const saltRounds = 12;

const createToken = (user) =>
  jwt.sign(
    { id: user.id, email: user.email, full_name: user.full_name },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

const formatUser = (row) => ({
  id: row.id,
  email: row.email,
  full_name: row.full_name,
  created_at: row.created_at,
});

router.post("/register", async (req, res) => {
  const { email, password, full_name } = req.body;

  if (!email || !password || !full_name) {
    return res
      .status(400)
      .json({ message: "Email, password, and full_name are required" });
  }

  if (password.length < 8) {
    return res
      .status(400)
      .json({ message: "Password must be at least 8 characters long" });
  }

  try {
    const pool = getPool();
    const existingUser = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [email.toLowerCase()]
    );

    if (existingUser.rowCount > 0) {
      return res.status(409).json({ message: "Email already exists" });
    }

    const passwordHash = await bcrypt.hash(password, saltRounds);
    const insertedUser = await pool.query(
      `
        INSERT INTO users (email, password_hash, full_name)
        VALUES ($1, $2, $3)
        RETURNING id, email, full_name, created_at
      `,
      [email.toLowerCase(), passwordHash, full_name.trim()]
    );

    const user = formatUser(insertedUser.rows[0]);
    const token = createToken(user);

    return res.status(201).json({ token, user });
  } catch (error) {
    console.error("Register error:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  try {
    const pool = getPool();
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [
      email.toLowerCase(),
    ]);

    if (result.rowCount === 0) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const userRow = result.rows[0];
    const passwordMatches = await bcrypt.compare(
      password,
      userRow.password_hash
    );

    if (!passwordMatches) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const user = formatUser(userRow);
    const token = createToken(user);

    return res.json({ token, user });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

router.get("/me", authMiddleware, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(
      `
        SELECT id, email, full_name, created_at
        FROM users
        WHERE id = $1
      `,
      [req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.json({ user: formatUser(result.rows[0]) });
  } catch (error) {
    console.error("Fetch current user error:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
