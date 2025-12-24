// Simple Node/Express backend for Axis chatbot using DeepSeek API
// IMPORTANT: Do NOT hard-code your API key here. Use the DEEPSEEK_API_KEY environment variable.

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { z } = require("zod");
const path = require("path");
const fs = require("fs").promises;
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const USERS_FILE = path.join(__dirname, "users.json");
const USER_DATA_DIR = path.join(__dirname, "user_data");

if (!JWT_SECRET || JWT_SECRET.trim().length < 32) {
  console.warn(
    "⚠️  WARNING: JWT_SECRET is not set or is too short. Set JWT_SECRET in .env (>= 32 chars) for secure auth.",
  );
}

function normalizeApiKey(key) {
  if (!key) return "";
  return String(key).trim().replace(/^Bearer\\s+/i, "");
}

function maskApiKey(key) {
  if (!key) return "";
  if (key.length <= 8) return "********";
  return `${key.slice(0, 3)}…${key.slice(-4)}`;
}

const DEEPSEEK_API_KEY = normalizeApiKey(process.env.DEEPSEEK_API_KEY);
const DEEPSEEK_BASE_URL =
  (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1/chat/completions").trim();
const DEEPSEEK_MODEL = (process.env.DEEPSEEK_MODEL || "deepseek-chat").trim();

if (!DEEPSEEK_API_KEY || DEEPSEEK_API_KEY === "your_deepseek_api_key_here") {
  console.warn(
    "⚠️  WARNING: DEEPSEEK_API_KEY is not set or still has placeholder value.",
  );
  console.warn(
    "   Please edit the .env file and add your actual DeepSeek API key.",
  );
  console.warn(
    "   Get your API key from: https://platform.deepseek.com/",
  );
  console.warn(
    "   DEEPSEEK_API_KEY: ", maskApiKey(DEEPSEEK_API_KEY),
  );
}

// ---------- DeepSeek helpers ----------
function safeParseJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function callDeepSeek({
  system,
  user,
  temperature = 0.35,
  maxTokens = 900,
  expectJSON = false,
}) {
  if (!DEEPSEEK_API_KEY) {
    throw new Error("DEEPSEEK_API_KEY is not configured on the server.");
  }

  const payload = {
    model: DEEPSEEK_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature,
    max_tokens: maxTokens,
  };

  // DeepSeek supports OpenAI-style response_format on newer models
  if (expectJSON) {
    payload.response_format = { type: "json_object" };
  }

  const response = await fetch(DEEPSEEK_BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error("DeepSeek API error:", response.status, text);
    let errorMessage = "Upstream DeepSeek API error.";
    const parsed = safeParseJSON(text);
    if (parsed?.error?.message) {
      errorMessage = parsed.error.message;
    }
    throw new Error(`${errorMessage} (status ${response.status})`);
  }

  const data = await response.json();
  const reply = data.choices?.[0]?.message?.content;
  if (!reply) {
    throw new Error("DeepSeek reply missing content");
  }
  return reply.trim();
}

// --- Security / hardening middleware ---
app.disable("x-powered-by");

// In production you should lock this down to your real domain(s).
app.use(cors({ origin: true, credentials: false }));
app.use(helmet());
app.use(express.json({ limit: "256kb" }));

// Basic rate limits (tunable)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api/", apiLimiter);
app.use("/api/auth/", authLimiter);

function requireJwtSecret(res) {
  if (!JWT_SECRET || JWT_SECRET.trim().length < 32) {
    res
      .status(500)
      .json({ error: "Server misconfigured: JWT_SECRET must be set (>= 32 chars)." });
    return false;
  }
  return true;
}

// --- Request validation schemas ---
const registerSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(200),
  name: z.string().min(1).max(100),
});

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
});

function validateBody(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request body",
        details: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
      });
    }
    req.body = parsed.data;
    next();
  };
}

// Ensure user_data directory exists and users file is initialized
(async () => {
  try {
    await fs.mkdir(USER_DATA_DIR, { recursive: true });
    console.log("✓ user_data directory ready");
  } catch (err) {
    console.error("Error creating user_data directory:", err);
  }
  
  try {
    await fs.access(USERS_FILE);
    console.log("✓ users.json file exists");
  } catch {
    await fs.writeFile(USERS_FILE, JSON.stringify({}, null, 2));
    console.log("✓ users.json file created");
  }
})();

// Helper functions for user management
async function getUsers() {
  try {
    const data = await fs.readFile(USERS_FILE, "utf8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

async function saveUsers(users) {
  await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
}

async function getUserData(userId) {
  const filePath = path.join(USER_DATA_DIR, `${userId}.json`);
  try {
    const data = await fs.readFile(filePath, "utf8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function saveUserData(userId, data) {
  const filePath = path.join(USER_DATA_DIR, `${userId}.json`);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

// Middleware to verify JWT token
function authenticateToken(req, res, next) {
  if (!requireJwtSecret(res)) return;
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: "Invalid or expired token" });
    }
    req.user = user;
    next();
  });
}

// Authentication endpoints
app.post("/api/auth/register", validateBody(registerSchema), async (req, res) => {
  try {
    if (!requireJwtSecret(res)) return;

    const { email, password, name } = req.body;

    const users = await getUsers();
    if (users[email]) {
      return res.status(409).json({ error: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    users[email] = {
      id: userId,
      email,
      password: hashedPassword,
      name,
      createdAt: new Date().toISOString(),
    };

    await saveUsers(users);

    // Initialize user data
    await saveUserData(userId, {
      profile: null,
      tasks: [],
      rankedTasks: [],
      schedule: [],
      fixedBlocks: [],
      goals: [],
      reflections: [],
      blockingRules: [],
    });

    const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, user: { id: userId, email, name } });
  } catch (err) {
    console.error("Registration error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/auth/login", validateBody(loginSchema), async (req, res) => {
  try {
    if (!requireJwtSecret(res)) return;

    const { email, password } = req.body;

    const users = await getUsers();
    const user = users[email];
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign({ userId: user.id, email }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, user: { id: user.id, email, name: user.name } });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/auth/google", async (req, res) => {
  try {
    const { email, name, googleId } = req.body;
    if (!email || !name || !googleId) {
      return res.status(400).json({ error: "Email, name, and googleId are required" });
    }

    const users = await getUsers();
    let user = users[email];

    if (!user) {
      // Create new user
      const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      user = {
        id: userId,
        email,
        name,
        googleId,
        createdAt: new Date().toISOString(),
      };
      users[email] = user;
      await saveUsers(users);

      // Initialize user data
      await saveUserData(userId, {
        profile: null,
        tasks: [],
        rankedTasks: [],
        schedule: [],
        fixedBlocks: [],
        goals: [],
        reflections: [],
        blockingRules: [],
      });
    } else if (!user.googleId) {
      // Link Google account to existing user
      user.googleId = googleId;
      users[email] = user;
      await saveUsers(users);
    }

    const token = jwt.sign({ userId: user.id, email }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, user: { id: user.id, email, name: user.name } });
  } catch (err) {
    console.error("Google auth error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// User data endpoints
app.get("/api/user/data", authenticateToken, async (req, res) => {
  try {
    const data = await getUserData(req.user.userId);
    if (!data) {
      return res.status(404).json({ error: "User data not found" });
    }
    res.json(data);
  } catch (err) {
    console.error("Get user data error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/user/data", authenticateToken, async (req, res) => {
  try {
    await saveUserData(req.user.userId, req.body);
    res.json({ success: true });
  } catch (err) {
    console.error("Save user data error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Profile update endpoint
app.put("/api/user/profile", authenticateToken, async (req, res) => {
  try {
    const { name } = req.body;
    
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ error: "Name is required" });
    }

    const users = await getUsers();
    const userEmail = req.user.email;
    
    if (!users[userEmail]) {
      return res.status(404).json({ error: "User not found" });
    }

    // Update user name
    users[userEmail].name = name.trim();
    users[userEmail].updatedAt = new Date().toISOString();
    await saveUsers(users);

    res.json({ 
      success: true, 
      user: { 
        id: users[userEmail].id, 
        email: userEmail, 
        name: users[userEmail].name 
      } 
    });
  } catch (err) {
    console.error("Profile update error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Password change endpoint
app.put("/api/user/password", authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current and new passwords are required" });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters" });
    }

    const users = await getUsers();
    const userEmail = req.user.email;
    const user = users[userEmail];
    
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Google-only accounts don't have passwords
    if (!user.password && user.googleId) {
      return res.status(400).json({ error: "Cannot change password for Google-linked accounts" });
    }

    // Verify current password
    const validPassword = await bcrypt.compare(currentPassword, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    // Hash and save new password
    user.password = await bcrypt.hash(newPassword, 10);
    user.updatedAt = new Date().toISOString();
    await saveUsers(users);

    res.json({ success: true, message: "Password updated successfully" });
  } catch (err) {
    console.error("Password change error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Account deletion endpoint
app.delete("/api/user/account", authenticateToken, async (req, res) => {
  try {
    const users = await getUsers();
    const userEmail = req.user.email;
    
    if (!users[userEmail]) {
      return res.status(404).json({ error: "User not found" });
    }

    const userId = users[userEmail].id;

    // Delete user data file
    const userDataPath = path.join(USER_DATA_DIR, `${userId}.json`);
    try {
      await fs.unlink(userDataPath);
    } catch (err) {
      // Ignore if file doesn't exist
      if (err.code !== "ENOENT") {
        console.error("Error deleting user data file:", err);
      }
    }

    // Delete user from users.json
    delete users[userEmail];
    await saveUsers(users);

    res.json({ success: true, message: "Account deleted successfully" });
  } catch (err) {
    console.error("Account deletion error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get user info endpoint
app.get("/api/user/info", authenticateToken, async (req, res) => {
  try {
    const users = await getUsers();
    const user = users[req.user.email];
    
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({
      id: user.id,
      email: req.user.email,
      name: user.name,
      createdAt: user.createdAt,
      googleLinked: !!user.googleId
    });
  } catch (err) {
    console.error("Get user info error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---------- AI Planning Endpoints (DeepSeek-powered) ----------

app.post("/api/ai/task-priority", async (req, res) => {
  try {
    const {
      description = "",
      category = "",
      deadlineDate = "",
      deadlineTime = "",
      durationHours = null,
      urgentHint = "",
      importantHint = "",
    } = req.body || {};

    if (!description || typeof description !== "string") {
      return res.status(400).json({ error: "Missing 'description' in request body." });
    }

    const normalizedUrgentHint = String(urgentHint || "").trim().toLowerCase();
    const normalizedImportantHint = String(importantHint || "").trim().toLowerCase();

    const userPrompt = `
Decide the Eisenhower priority for this task.
Return JSON only: {"task_priority":"Urgent & Important"|"Urgent, Not Important"|"Important, Not Urgent"|"Not Urgent & Not Important","reason":"short"}.
- Use the user's urgent/important hints as signals, but you may override if the deadline/duration strongly suggests otherwise.
Task description: ${description}
Category: ${category || "unknown"}
Deadline: ${deadlineDate || "unknown"} ${deadlineTime || ""}
Estimated duration (hours): ${durationHours ?? "unknown"}
User says urgent: ${normalizedUrgentHint || "unknown"}
User says important: ${normalizedImportantHint || "unknown"}
`.trim();

    const reply = await callDeepSeek({
      system: "You are an AI planner. Return strict JSON only.",
      user: userPrompt,
      temperature: 0.2,
      maxTokens: 180,
      expectJSON: true,
    });

    const parsed = safeParseJSON(reply) || {};
    const allowed = new Set([
      "Urgent & Important",
      "Urgent, Not Important",
      "Important, Not Urgent",
      "Not Urgent & Not Important",
    ]);

    if (!allowed.has(parsed.task_priority)) {
      return res.status(502).json({ error: "AI returned an invalid task_priority." });
    }

    res.json({ task_priority: parsed.task_priority, reason: parsed.reason || "" });
  } catch (err) {
    console.error("task-priority error:", err);
    res.status(500).json({ error: err.message || "Task priority failed" });
  }
});

app.post("/api/ai/prioritize-tasks", authenticateToken, async (req, res) => {
  try {
    const { tasks = [], profile = {}, timeBudgetHours = 6 } = req.body || {};
    const userPrompt = `
Given the tasks and user profile, rank the top tasks to do next.
Output JSON only: {"rankedTasks":[{"id":"task-id","score":0-100,"reason":"why","deadlineRisk":"low|medium|high","bucket":"do-first|schedule|delegate|drop"}]}
- Prefer tasks with earlier deadlines, higher priority, and small duration fits in ~${timeBudgetHours}h today.
- Avoid overcommitting; include at most 7 tasks.
Tasks: ${JSON.stringify(tasks).slice(0, 6000)}
Profile: ${JSON.stringify(profile).slice(0, 2000)}
`.trim();

    const reply = await callDeepSeek({
      system: "You are an AI planner. Be concise and return strict JSON.",
      user: userPrompt,
      temperature: 0.2,
      maxTokens: 700,
      expectJSON: true,
    });
    const parsed = safeParseJSON(reply) || { rankedTasks: [] };
    res.json(parsed);
  } catch (err) {
    console.error("prioritize-tasks error:", err);
    res.status(500).json({ error: err.message || "Prioritization failed" });
  }
});

app.post("/api/ai/schedule", authenticateToken, async (req, res) => {
  try {
    const {
      tasks = [],
      fixedBlocks = [],
      productiveWindows = {},
      day = "today",
      maxHours = 10,
    } = req.body || {};

    const userPrompt = `
Build a simple schedule for ${day}.
Respect fixed blocks and avoid overlapping times.
Prefer placing high-priority tasks in productive windows when provided.
Return JSON only: {"blocks":[{"taskId":"id","start":"HH:MM","end":"HH:MM","reason":"short note"}]}
- Cap total scheduled work to about ${maxHours} hours.
Tasks: ${JSON.stringify(tasks).slice(0, 6000)}
Fixed blocks: ${JSON.stringify(fixedBlocks).slice(0, 3000)}
Productive windows: ${JSON.stringify(productiveWindows).slice(0, 1500)}
`.trim();

    const reply = await callDeepSeek({
      system: "You are a time-blocking assistant. Return valid JSON only.",
      user: userPrompt,
      temperature: 0.25,
      maxTokens: 700,
      expectJSON: true,
    });
    const parsed = safeParseJSON(reply) || { blocks: [] };
    res.json(parsed);
  } catch (err) {
    console.error("schedule error:", err);
    res.status(500).json({ error: err.message || "Schedule generation failed" });
  }
});

app.post("/api/ai/reflection-summary", authenticateToken, async (req, res) => {
  try {
    const { reflections = [], goals = [] } = req.body || {};
    const userPrompt = `
Summarize the recent reflections and suggest a weekly focus.
Return JSON only: {"summary":"2-3 bullet sentences","focus":"one theme","habit":"one small habit","risk":"one risk to watch"}
Reflections: ${JSON.stringify(reflections).slice(0, 5000)}
Goals: ${JSON.stringify(goals).slice(0, 3000)}
`.trim();

    const reply = await callDeepSeek({
      system: "You are a concise coach. JSON only.",
      user: userPrompt,
      temperature: 0.3,
      maxTokens: 500,
      expectJSON: true,
    });
    const parsed = safeParseJSON(reply) || {};
    res.json(parsed);
  } catch (err) {
    console.error("reflection-summary error:", err);
    res.status(500).json({ error: err.message || "Reflection analysis failed" });
  }
});

app.post("/api/ai/mood-plan", authenticateToken, async (req, res) => {
  try {
    const { mood = "neutral", energy = "medium", tasks = [] } = req.body || {};
    const userPrompt = `
Given mood "${mood}" and energy "${energy}", pick matching work styles.
Return JSON only: {"plan":"short guidance","suggestedTasks":["taskId",...],"break":"break advice"}
Tasks: ${JSON.stringify(tasks).slice(0, 3000)}
`.trim();

    const reply = await callDeepSeek({
      system: "You are an emotion-aware study coach. JSON only.",
      user: userPrompt,
      temperature: 0.35,
      maxTokens: 400,
      expectJSON: true,
    });
    const parsed = safeParseJSON(reply) || {};
    res.json(parsed);
  } catch (err) {
    console.error("mood-plan error:", err);
    res.status(500).json({ error: err.message || "Mood plan failed" });
  }
});

app.post("/api/ai/habit", authenticateToken, async (req, res) => {
  try {
    const { goals = [], recentTasks = [] } = req.body || {};
    const userPrompt = `
Suggest one tiny daily habit that supports the goals.
Return JSON only: {"habit":"one line","when":"time suggestion","why":"short reason"}
Goals: ${JSON.stringify(goals).slice(0, 2000)}
Recent tasks: ${JSON.stringify(recentTasks).slice(0, 2000)}
`.trim();

    const reply = await callDeepSeek({
      system: "You are a behavior change coach. JSON only.",
      user: userPrompt,
      temperature: 0.35,
      maxTokens: 400,
      expectJSON: true,
    });
    const parsed = safeParseJSON(reply) || {};
    res.json(parsed);
  } catch (err) {
    console.error("habit error:", err);
    res.status(500).json({ error: err.message || "Habit suggestion failed" });
  }
});

app.post("/api/ai/focus-tuning", authenticateToken, async (req, res) => {
  try {
    const { blocks = [], estimates = [] } = req.body || {};
    const userPrompt = `
Given recent focus blocks and estimate accuracy, suggest block length.
Return JSON only: {"lengthMinutes":25,"bufferMinutes":5,"tip":"one sentence","reason":"short"}
Blocks: ${JSON.stringify(blocks).slice(0, 4000)}
Estimates: ${JSON.stringify(estimates).slice(0, 2000)}
`.trim();

    const reply = await callDeepSeek({
      system: "You are a focus coach. JSON only.",
      user: userPrompt,
      temperature: 0.3,
      maxTokens: 350,
      expectJSON: true,
    });
    const parsed = safeParseJSON(reply) || {};
    res.json(parsed);
  } catch (err) {
    console.error("focus-tuning error:", err);
    res.status(500).json({ error: err.message || "Focus tuning failed" });
  }
});

// Serve the existing static front-end (index.html, script.js, style.css, etc.)
app.use(express.static(path.join(__dirname)));

app.post("/api/chat", async (req, res) => {
  try {
    const { message, context } = req.body || {};
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Missing 'message' in request body." });
    }

    const systemPrompt =
      "You are Axis, a supportive, gender-neutral, professional AI study planner. " +
      "You help students prioritize tasks, manage time, combat procrastination, and protect work-life balance. " +
      "Keep answers short, concrete, and actionable. Never encourage procrastination.";

    let userContent = message;
    if (context && typeof context === "string") {
      userContent = `Context:\n${context}\n\nUser question:\n${message}`;
    }

    const reply = await callDeepSeek({
      system: systemPrompt,
      user: userContent,
      temperature: 0.7,
      maxTokens: 512,
    });

    res.json({ reply });
  } catch (err) {
    console.error("Error in /api/chat:", err);
    res.status(502).json({ error: err.message || "Upstream AI error." });
  }
});

app.listen(PORT, () => {
  console.log(`Axis server running at http://localhost:${PORT}`);
});
