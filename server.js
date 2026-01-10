// Simple Node/Express backend for Axis AI endpoints (DeepSeek / OpenAI / Gemini).
// IMPORTANT: Do NOT hard-code API keys here. Use environment variables in `.env`.

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { z } = require("zod");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs").promises;
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const USERS_FILE = path.join(__dirname, "users.json");
const USER_DATA_DIR = path.join(__dirname, "user_data");

// Auto-generate JWT_SECRET if not set or too short
const JWT_SECRET = (() => {
  const envSecret = process.env.JWT_SECRET;
  if (envSecret && envSecret.trim().length >= 32) {
    return envSecret.trim();
  }
  // Generate a secure random secret for this session
  const generatedSecret = crypto.randomBytes(48).toString("base64");
  console.log("⚠️  JWT_SECRET not set or too short. Auto-generated a secure secret for this session.");
  console.log("   Note: Users will need to re-login if the server restarts.");
  console.log("   For persistent sessions, add JWT_SECRET to your .env file (>= 32 chars).");
  return generatedSecret;
})();

function normalizeApiKey(key) {
  if (!key) return "";
  return String(key).trim().replace(/^Bearer\s+/i, "");
}

function maskApiKey(key) {
  if (!key) return "";
  if (key.length <= 8) return "********";
  return `${key.slice(0, 3)}…${key.slice(-4)}`;
}

const LLM_PROVIDER = (process.env.LLM_PROVIDER || process.env.AI_PROVIDER || "deepseek")
  .trim()
  .toLowerCase();

const DEEPSEEK_API_KEY = normalizeApiKey(process.env.DEEPSEEK_API_KEY);
const DEEPSEEK_BASE_URL =
  (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1/chat/completions").trim();
const DEEPSEEK_MODEL = (process.env.DEEPSEEK_MODEL || "deepseek-chat").trim();

const OPENAI_API_KEY = normalizeApiKey(process.env.OPENAI_API_KEY);
const OPENAI_BASE_URL =
  (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1/chat/completions").trim();
const OPENAI_MODEL = (process.env.OPENAI_MODEL || "gpt-4o-mini").trim();

const GEMINI_API_KEY = normalizeApiKey(process.env.GEMINI_API_KEY);
const GEMINI_BASE_URL = (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta")
  .trim()
  .replace(/\/+$/, "");
const GEMINI_MODEL = (process.env.GEMINI_MODEL || "gemini-1.5-flash").trim();

const SUPPORTED_LLM_PROVIDERS = new Set(["deepseek", "openai", "gemini"]);
if (!SUPPORTED_LLM_PROVIDERS.has(LLM_PROVIDER)) {
  console.warn(`⚠️  WARNING: Unsupported LLM_PROVIDER "${LLM_PROVIDER}". Falling back to "deepseek".`);
}

if (LLM_PROVIDER === "deepseek" && (!DEEPSEEK_API_KEY || DEEPSEEK_API_KEY === "your_deepseek_api_key_here")) {
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

if (LLM_PROVIDER === "openai" && (!OPENAI_API_KEY || OPENAI_API_KEY === "your_openai_api_key_here")) {
  console.warn(
    "⚠️  WARNING: OPENAI_API_KEY is not set or still has placeholder value.",
  );
  console.warn(
    "   Please edit the .env file and add your actual OpenAI API key.",
  );
  console.warn(
    "   Get your API key from: https://platform.openai.com/",
  );
  console.warn(
    "   OPENAI_API_KEY: ", maskApiKey(OPENAI_API_KEY),
  );
}

if (LLM_PROVIDER === "gemini" && (!GEMINI_API_KEY || GEMINI_API_KEY === "your_gemini_api_key_here")) {
  console.warn(
    "⚠️  WARNING: GEMINI_API_KEY is not set or still has placeholder value.",
  );
  console.warn(
    "   Please edit the .env file and add your actual Gemini API key.",
  );
  console.warn(
    "   Get your API key from: https://aistudio.google.com/app/apikey",
  );
  console.warn(
    "   GEMINI_API_KEY: ", maskApiKey(GEMINI_API_KEY),
  );
}

// ---------- LLM helpers ----------
function safeParseJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ---------- iCalendar (.ics) helpers ----------
function icsEscapeText(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\r/g, "")
    .replace(/\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function formatIcsDateTimeUtc(date) {
  const iso = date.toISOString(); // 2026-01-05T14:00:00.000Z
  return iso.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function foldIcsLine(line) {
  const parts = [];
  let remaining = String(line);
  // RFC 5545: 75 octets; approximate with 75 chars for ASCII output.
  while (remaining.length > 75) {
    parts.push(remaining.slice(0, 75));
    remaining = ` ${remaining.slice(75)}`;
  }
  parts.push(remaining);
  return parts;
}

function buildAxisIcs({ userId, data, options }) {
  const includeFixedBlocks = options?.includeFixedBlocks !== false;
  const includeCompletedTasks = options?.includeCompletedTasks === true;
  const reminderMinutes = Number.isFinite(options?.reminderMinutes)
    ? Math.max(0, Math.min(240, Math.round(options.reminderMinutes)))
    : 15;

  const tasks = Array.isArray(data?.tasks) ? data.tasks : [];
  const tasksById = new Map(tasks.map((t) => [t.id, t]));
  const completedTaskIds = new Set(tasks.filter((t) => t?.completed).map((t) => t.id));

  const scheduleBlocks = Array.isArray(data?.schedule) ? data.schedule : [];
  const fixedBlocks = includeFixedBlocks && Array.isArray(data?.fixedBlocks) ? data.fixedBlocks : [];

  const now = new Date();
  const dtStamp = formatIcsDateTimeUtc(now);
  const calName = "Axis Schedule";

  const lines = [];
  const push = (line) => foldIcsLine(line).forEach((l) => lines.push(l));

  push("BEGIN:VCALENDAR");
  push("VERSION:2.0");
  push("CALSCALE:GREGORIAN");
  push("METHOD:PUBLISH");
  push("PRODID:-//Axis//EN");
  push(`X-WR-CALNAME:${icsEscapeText(calName)}`);
  push("X-WR-TIMEZONE:UTC");

  const addEvent = ({ summary, description, start, end, categories, uidSeed }) => {
    const uid = crypto
      .createHash("sha1")
      .update(String(uidSeed || `${userId}:${summary}:${start.toISOString()}:${end.toISOString()}`))
      .digest("hex");

    push("BEGIN:VEVENT");
    push(`UID:${uid}@axis`);
    push(`DTSTAMP:${dtStamp}`);
    push(`DTSTART:${formatIcsDateTimeUtc(start)}`);
    push(`DTEND:${formatIcsDateTimeUtc(end)}`);
    push(`SUMMARY:${icsEscapeText(summary)}`);
    if (description) push(`DESCRIPTION:${icsEscapeText(description)}`);
    if (categories?.length) push(`CATEGORIES:${categories.map((c) => icsEscapeText(c)).join(",")}`);

    if (reminderMinutes > 0) {
      push("BEGIN:VALARM");
      push("ACTION:DISPLAY");
      push(`DESCRIPTION:${icsEscapeText(summary)}`);
      push(`TRIGGER:-PT${reminderMinutes}M`);
      push("END:VALARM");
    }

    push("END:VEVENT");
  };

  scheduleBlocks.forEach((b) => {
    const taskId = b?.taskId;
    if (!taskId) return;
    if (!includeCompletedTasks && completedTaskIds.has(taskId)) return;
    const start = new Date(b.start);
    const end = new Date(b.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return;

    const task = tasksById.get(taskId) || null;
    const summary = task?.task_name ? String(task.task_name) : "Task";
    const category = task?.task_category ? String(task.task_category) : "";
    const priority = task?.task_priority ? String(task.task_priority) : "";
    const deadline = task?.task_deadline ? `${task.task_deadline} ${task.task_deadline_time || ""}`.trim() : "";

    const descriptionParts = [];
    if (category) descriptionParts.push(`Category: ${category}`);
    if (priority) descriptionParts.push(`Priority: ${priority}`);
    if (deadline) descriptionParts.push(`Deadline: ${deadline}`);

    addEvent({
      summary,
      description: descriptionParts.join("\n"),
      start,
      end,
      categories: category ? [category] : [],
      uidSeed: `${userId}:task:${taskId}:${start.toISOString()}:${end.toISOString()}`,
    });
  });

  fixedBlocks.forEach((b) => {
    const start = new Date(b.start);
    const end = new Date(b.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return;

    const label = String(b.label || "Fixed block");
    const category = b.category ? String(b.category) : "";
    addEvent({
      summary: label,
      description: category ? `Category: ${category}` : "",
      start,
      end,
      categories: category ? [category] : [],
      uidSeed: `${userId}:fixed:${label}:${start.toISOString()}:${end.toISOString()}`,
    });
  });

  push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
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

async function callOpenAI({
  system,
  user,
  temperature = 0.35,
  maxTokens = 900,
  expectJSON = false,
}) {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured on the server.");
  }

  const payload = {
    model: OPENAI_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature,
    max_tokens: maxTokens,
  };

  if (expectJSON) {
    payload.response_format = { type: "json_object" };
  }

  const response = await fetch(OPENAI_BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error("OpenAI-compatible API error:", response.status, text);
    let errorMessage = "Upstream OpenAI-compatible API error.";
    const parsed = safeParseJSON(text);
    if (parsed?.error?.message) {
      errorMessage = parsed.error.message;
    }
    throw new Error(`${errorMessage} (status ${response.status})`);
  }

  const data = await response.json();
  const reply = data.choices?.[0]?.message?.content;
  if (!reply) {
    throw new Error("OpenAI reply missing content");
  }
  return reply.trim();
}

async function callGemini({
  system,
  user,
  temperature = 0.35,
  maxTokens = 900,
  expectJSON = false,
}) {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured on the server.");
  }

  const modelName = GEMINI_MODEL.replace(/^models\//, "");
  const endpoint = `${GEMINI_BASE_URL}/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  const payload = {
    ...(system
      ? {
          systemInstruction: {
            role: "system",
            parts: [{ text: system }],
          },
        }
      : {}),
    contents: [
      {
        role: "user",
        parts: [{ text: user }],
      },
    ],
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      ...(expectJSON ? { responseMimeType: "application/json" } : {}),
    },
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error("Gemini API error:", response.status, text);
    let errorMessage = "Upstream Gemini API error.";
    const parsed = safeParseJSON(text);
    if (parsed?.error?.message) {
      errorMessage = parsed.error.message;
    }
    throw new Error(`${errorMessage} (status ${response.status})`);
  }

  const data = await response.json();
  const parts = data.candidates?.[0]?.content?.parts;
  const reply = Array.isArray(parts) ? parts.map((p) => p?.text || "").join("") : "";
  if (!reply) {
    throw new Error("Gemini reply missing content");
  }
  return reply.trim();
}

async function callLlm(options) {
  const requested = String(options?.provider || LLM_PROVIDER || "deepseek")
    .trim()
    .toLowerCase();
  const provider = SUPPORTED_LLM_PROVIDERS.has(requested) ? requested : "deepseek";

  if (provider === "openai") return callOpenAI(options);
  if (provider === "gemini") return callGemini(options);
  return callDeepSeek(options);
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

const aiRescheduleSchema = z.object({
  tasks: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        task_name: z.string().optional(),
        task_priority: z.string().optional(),
        task_category: z.string().optional(),
        task_deadline: z.string().optional(),
        task_deadline_time: z.string().optional(),
        task_duration_hours: z.number().optional().nullable(),
        completed: z.boolean().optional(),
      }),
    )
    .max(800)
    .default([]),
  fixedBlocks: z
    .array(
      z.object({
        start: z.string().min(1).max(60),
        end: z.string().min(1).max(60),
        label: z.string().optional(),
        category: z.string().optional(),
        kind: z.string().optional(),
      }),
    )
    .max(1200)
    .default([]),
  schedule: z
    .array(
      z.object({
        taskId: z.string().optional(),
        start: z.string().min(1).max(60),
        end: z.string().min(1).max(60),
        kind: z.string().optional(),
      }),
    )
    .max(2000)
    .default([]),
  profile: z.any().optional(),
  horizonDays: z.number().int().min(1).max(21).default(7),
  maxHoursPerDay: z.number().min(1).max(16).default(10),
});

const calendarExportSchema = z.object({
  includeFixedBlocks: z.boolean().optional().default(true),
  includeCompletedTasks: z.boolean().optional().default(false),
  reminderMinutes: z.number().int().min(0).max(240).optional().default(15),
});

const assistantAgentRequestSchema = z.object({
  message: z.string().min(1).max(4000),
});

const taskCreateSchema = z.object({
  task_name: z.string().min(1).max(200),
  task_priority: z.string().optional(),
  task_category: z.string().optional(),
  task_deadline: z.string().optional(),
  task_deadline_time: z.string().optional(),
  task_duration_hours: z.number().optional().nullable(),
  computer_required: z.boolean().optional(),
});

const taskUpdateSchema = z.object({
  task_name: z.string().min(1).max(200).optional(),
  task_priority: z.string().optional(),
  task_category: z.string().optional(),
  task_deadline: z.string().optional(),
  task_deadline_time: z.string().optional(),
  task_duration_hours: z.number().optional().nullable(),
  computer_required: z.boolean().optional(),
  completed: z.boolean().optional(),
});

const habitCreateSchema = z.object({
  name: z.string().min(1).max(120),
  time: z.string().min(1).max(40),
  description: z.string().max(240).optional().default(""),
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

function ensureAxisUserDataShape(data) {
  if (!data || typeof data !== "object") {
    return {
      profile: null,
      tasks: [],
      rankedTasks: [],
      schedule: [],
      fixedBlocks: [],
      goals: [],
      reflections: [],
      blockingRules: [],
      dailyHabits: [],
      focusSessions: [],
      weeklyInsights: null,
      achievements: {},
      taskTemplates: [],
      calendarExportSettings: null,
      firstReflectionDueDate: null,
    };
  }

  return {
    profile: data.profile ?? null,
    tasks: Array.isArray(data.tasks) ? data.tasks : [],
    rankedTasks: Array.isArray(data.rankedTasks) ? data.rankedTasks : [],
    schedule: Array.isArray(data.schedule) ? data.schedule : [],
    fixedBlocks: Array.isArray(data.fixedBlocks) ? data.fixedBlocks : [],
    goals: Array.isArray(data.goals) ? data.goals : [],
    reflections: Array.isArray(data.reflections) ? data.reflections : [],
    blockingRules: Array.isArray(data.blockingRules) ? data.blockingRules : [],
    dailyHabits: Array.isArray(data.dailyHabits) ? data.dailyHabits : [],
    focusSessions: Array.isArray(data.focusSessions) ? data.focusSessions : [],
    weeklyInsights: data.weeklyInsights ?? null,
    achievements: data.achievements && typeof data.achievements === "object" ? data.achievements : {},
    taskTemplates: Array.isArray(data.taskTemplates) ? data.taskTemplates : [],
    calendarExportSettings: data.calendarExportSettings ?? null,
    firstReflectionDueDate: data.firstReflectionDueDate ?? null,
  };
}

function normalizeTaskPriority(value) {
  if (!value) return "";
  const v = String(value).trim();
  const allowed = new Set([
    "Urgent & Important",
    "Urgent, Not Important",
    "Important, Not Urgent",
    "Not Urgent & Not Important",
  ]);
  if (allowed.has(v)) return v;

  const legacy = {
    "urgent-important": "Urgent & Important",
    "urgent-not-important": "Urgent, Not Important",
    "important-not-urgent": "Important, Not Urgent",
    "not-urgent-not-important": "Not Urgent & Not Important",
  };
  const key = v.toLowerCase().replace(/[^a-z]+/g, "-");
  return legacy[key] || "";
}

function normalizeTaskCategory(value) {
  if (!value) return "study";
  return String(value).trim().toLowerCase();
}

function clampTaskDurationHours(value) {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(24, n);
}

function createAxisTask(input) {
  const taskName = String(input?.task_name || "").trim();
  const id = `task_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
  return {
    id,
    task_name: taskName,
    task_priority: normalizeTaskPriority(input?.task_priority) || "Important, Not Urgent",
    task_category: normalizeTaskCategory(input?.task_category),
    task_deadline: String(input?.task_deadline || "").trim(),
    task_deadline_time: String(input?.task_deadline_time || "23:59").trim(),
    task_duration_hours: clampTaskDurationHours(input?.task_duration_hours),
    computer_required: Boolean(input?.computer_required),
    completed: false,
    createdAt: new Date().toISOString(),
  };
}

function buildAssistantSnapshot(data) {
  const safeData = ensureAxisUserDataShape(data);
  const tasks = safeData.tasks.slice(0, 120).map((t) => ({
    id: String(t?.id || ""),
    name: String(t?.task_name || t?.name || "").slice(0, 180),
    priority: String(t?.task_priority || t?.priority || ""),
    category: String(t?.task_category || t?.category || ""),
    deadline: String(t?.task_deadline || t?.deadline || ""),
    deadlineTime: String(t?.task_deadline_time || t?.deadlineTime || ""),
    durationHours: Number(t?.task_duration_hours ?? t?.durationHours ?? t?.estimatedHours ?? 0) || 0,
    completed: Boolean(t?.completed),
  }));

  const schedule = safeData.schedule.slice(0, 200).map((b) => ({
    kind: String(b?.kind || ""),
    taskId: String(b?.taskId || ""),
    start: String(b?.start || ""),
    end: String(b?.end || ""),
    reason: typeof b?.reason === "string" ? b.reason.slice(0, 140) : "",
  }));

  const fixedBlocks = safeData.fixedBlocks.slice(0, 200).map((b) => ({
    label: String(b?.label || b?.kind || "Fixed").slice(0, 80),
    start: String(b?.start || ""),
    end: String(b?.end || ""),
    category: String(b?.category || ""),
  }));

  const dailyHabits = safeData.dailyHabits.slice(0, 80).map((h) => ({
    id: String(h?.id || ""),
    name: String(h?.name || "").slice(0, 120),
    time: String(h?.time || "").slice(0, 40),
    description: String(h?.description || "").slice(0, 180),
  }));

  const profile = safeData.profile && typeof safeData.profile === "object" ? safeData.profile : null;
  const profileBrief = profile
    ? {
        user_name: typeof profile.user_name === "string" ? profile.user_name.slice(0, 100) : "",
        user_age_group: typeof profile.user_age_group === "string" ? profile.user_age_group : "",
        most_productive_time: profile.most_productive_time || "",
        preferred_work_style: profile.preferred_work_style || "",
        preferred_study_method: profile.preferred_study_method || "",
        procrastinator_type: profile.procrastinator_type || "",
        has_trouble_finishing: profile.has_trouble_finishing || "",
      }
    : null;

  return {
    profile: profileBrief,
    tasks,
    schedule,
    fixedBlocks,
    dailyHabits,
  };
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

async function getOrCreateCalendarToken(userId) {
  const users = await getUsers();
  let foundEmail = null;
  let record = null;

  for (const [email, user] of Object.entries(users)) {
    if (user?.id === userId) {
      foundEmail = email;
      record = user;
      break;
    }
  }

  if (!record || !foundEmail) return null;
  if (record.calendarToken && typeof record.calendarToken === "string" && record.calendarToken.length >= 24) {
    return record.calendarToken;
  }

  const token = crypto.randomBytes(24).toString("hex");
  record.calendarToken = token;
  record.updatedAt = new Date().toISOString();
  users[foundEmail] = record;
  await saveUsers(users);
  return token;
}

async function getUserIdByCalendarToken(token) {
  if (!token || typeof token !== "string" || token.length < 24) return null;
  const users = await getUsers();
  for (const user of Object.values(users)) {
    if (user?.calendarToken === token) return user.id;
  }
  return null;
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

// ---------- Task + habit APIs ----------

app.get("/api/tasks", authenticateToken, async (req, res) => {
  try {
    const data = await getUserData(req.user.userId);
    if (!data) return res.status(404).json({ error: "User data not found" });
    const safeData = ensureAxisUserDataShape(data);
    res.json({ tasks: safeData.tasks });
  } catch (err) {
    console.error("tasks:list error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/tasks", authenticateToken, validateBody(taskCreateSchema), async (req, res) => {
  try {
    const data = await getUserData(req.user.userId);
    if (!data) return res.status(404).json({ error: "User data not found" });
    const safeData = ensureAxisUserDataShape(data);

    const created = createAxisTask(req.body);
    safeData.tasks.push(created);
    await saveUserData(req.user.userId, safeData);

    res.json({ task: created });
  } catch (err) {
    console.error("tasks:create error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.patch("/api/tasks/:taskId", authenticateToken, validateBody(taskUpdateSchema), async (req, res) => {
  try {
    const taskId = String(req.params.taskId || "").trim();
    if (!taskId) return res.status(400).json({ error: "Missing taskId" });

    const data = await getUserData(req.user.userId);
    if (!data) return res.status(404).json({ error: "User data not found" });
    const safeData = ensureAxisUserDataShape(data);

    const idx = safeData.tasks.findIndex((t) => t && String(t.id) === taskId);
    if (idx < 0) return res.status(404).json({ error: "Task not found" });

    const task = safeData.tasks[idx] && typeof safeData.tasks[idx] === "object" ? safeData.tasks[idx] : {};
    const patch = req.body || {};

    if (patch.task_name !== undefined) task.task_name = String(patch.task_name || "").trim();
    if (patch.task_priority !== undefined) {
      const normalized = normalizeTaskPriority(patch.task_priority);
      if (normalized) task.task_priority = normalized;
    }
    if (patch.task_category !== undefined) task.task_category = normalizeTaskCategory(patch.task_category);
    if (patch.task_deadline !== undefined) task.task_deadline = String(patch.task_deadline || "").trim();
    if (patch.task_deadline_time !== undefined) task.task_deadline_time = String(patch.task_deadline_time || "23:59").trim();
    if (patch.task_duration_hours !== undefined) task.task_duration_hours = clampTaskDurationHours(patch.task_duration_hours);
    if (patch.computer_required !== undefined) task.computer_required = Boolean(patch.computer_required);
    if (patch.completed !== undefined) {
      task.completed = Boolean(patch.completed);
      task.completedAt = task.completed ? new Date().toISOString() : undefined;
    }

    task.updatedAt = new Date().toISOString();
    safeData.tasks[idx] = task;
    await saveUserData(req.user.userId, safeData);

    res.json({ task });
  } catch (err) {
    console.error("tasks:update error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.delete("/api/tasks/:taskId", authenticateToken, async (req, res) => {
  try {
    const taskId = String(req.params.taskId || "").trim();
    if (!taskId) return res.status(400).json({ error: "Missing taskId" });

    const data = await getUserData(req.user.userId);
    if (!data) return res.status(404).json({ error: "User data not found" });
    const safeData = ensureAxisUserDataShape(data);

    const before = safeData.tasks.length;
    safeData.tasks = safeData.tasks.filter((t) => t && String(t.id) !== taskId);
    safeData.schedule = safeData.schedule.filter((b) => !(b && b.kind === "task" && String(b.taskId) === taskId));
    if (safeData.tasks.length === before) return res.status(404).json({ error: "Task not found" });

    await saveUserData(req.user.userId, safeData);
    res.json({ success: true });
  } catch (err) {
    console.error("tasks:delete error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/habits", authenticateToken, async (req, res) => {
  try {
    const data = await getUserData(req.user.userId);
    if (!data) return res.status(404).json({ error: "User data not found" });
    const safeData = ensureAxisUserDataShape(data);
    res.json({ dailyHabits: safeData.dailyHabits });
  } catch (err) {
    console.error("habits:list error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/habits", authenticateToken, validateBody(habitCreateSchema), async (req, res) => {
  try {
    const data = await getUserData(req.user.userId);
    if (!data) return res.status(404).json({ error: "User data not found" });
    const safeData = ensureAxisUserDataShape(data);

    const habit = {
      id: `habit_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`,
      name: String(req.body.name || "").trim(),
      time: String(req.body.time || "").trim(),
      description: String(req.body.description || "").trim(),
      createdAt: new Date().toISOString(),
    };
    safeData.dailyHabits.push(habit);
    await saveUserData(req.user.userId, safeData);
    res.json({ habit });
  } catch (err) {
    console.error("habits:create error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.delete("/api/habits/:habitId", authenticateToken, async (req, res) => {
  try {
    const habitId = String(req.params.habitId || "").trim();
    if (!habitId) return res.status(400).json({ error: "Missing habitId" });

    const data = await getUserData(req.user.userId);
    if (!data) return res.status(404).json({ error: "User data not found" });
    const safeData = ensureAxisUserDataShape(data);

    const before = safeData.dailyHabits.length;
    safeData.dailyHabits = safeData.dailyHabits.filter((h) => h && String(h.id) !== habitId);
    if (safeData.dailyHabits.length === before) return res.status(404).json({ error: "Habit not found" });

    await saveUserData(req.user.userId, safeData);
    res.json({ success: true });
  } catch (err) {
    console.error("habits:delete error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---------- Calendar Export (.ics) ----------

app.get("/api/calendar/token", authenticateToken, async (req, res) => {
  try {
    const token = await getOrCreateCalendarToken(req.user.userId);
    if (!token) {
      return res.status(404).json({ error: "User not found" });
    }
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const subscribeUrl = `${baseUrl}/api/calendar/subscribe/${token}.ics`;
    const webcalUrl = subscribeUrl.replace(/^https?:\/\//, "webcal://");
    res.json({ token, subscribeUrl, webcalUrl });
  } catch (err) {
    console.error("calendar token error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post(
  "/api/calendar/export",
  authenticateToken,
  validateBody(calendarExportSchema),
  async (req, res) => {
    try {
      const data = await getUserData(req.user.userId);
      if (!data) {
        return res.status(404).json({ error: "User data not found" });
      }

      const options = {
        ...(data.calendarExportSettings && typeof data.calendarExportSettings === "object"
          ? data.calendarExportSettings
          : {}),
        ...req.body,
      };

      const ics = buildAxisIcs({ userId: req.user.userId, data, options });
      res.setHeader("Content-Type", "text/calendar; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="axis-schedule.ics"');
      res.send(ics);
    } catch (err) {
      console.error("calendar export error:", err);
      res.status(500).json({ error: "Calendar export failed" });
    }
  },
);

app.get("/api/calendar/subscribe/:token.ics", async (req, res) => {
  try {
    const token = req.params.token;
    const userId = await getUserIdByCalendarToken(token);
    if (!userId) {
      return res.status(404).send("Not found");
    }

    const data = await getUserData(userId);
    if (!data) {
      return res.status(404).send("Not found");
    }

    const options =
      data.calendarExportSettings && typeof data.calendarExportSettings === "object"
        ? data.calendarExportSettings
        : {};

    const ics = buildAxisIcs({ userId, data, options });
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.send(ics);
  } catch (err) {
    console.error("calendar subscribe error:", err);
    res.status(500).send("Calendar subscribe failed");
  }
});

// ---------- Assistant (agentic) ----------

const assistantToolCallSchema = z.object({
  name: z.string().min(1).max(80),
  arguments: z.any().optional(),
});

const assistantPlannerResponseSchema = z.object({
  assistant_reply: z.string().min(1).max(6000),
  tool_calls: z.array(assistantToolCallSchema).optional().default([]),
});

const assistantFinalResponseSchema = z.object({
  reply: z.string().min(1).max(6000),
});

const assistantUpdateTaskSchema = taskUpdateSchema.extend({
  id: z.string().min(1).max(200),
});

const assistantDeleteTaskSchema = z.object({
  id: z.string().min(1).max(200),
});

const assistantDeleteHabitSchema = z.object({
  id: z.string().min(1).max(200),
});

const assistantRebalanceSchema = z.object({
  horizonDays: z.number().int().min(1).max(21).optional().default(7),
  maxHoursPerDay: z.number().min(1).max(16).optional().default(10),
});

const ASSISTANT_TOOLS = [
  {
    name: "get_snapshot",
    description: "Get a compact snapshot of the user's profile, tasks, schedule, fixed blocks, and daily habits.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_tasks",
    description: "List tasks. Optionally include completed tasks.",
    inputSchema: {
      type: "object",
      properties: { includeCompleted: { type: "boolean", default: false } },
    },
  },
  {
    name: "create_task",
    description:
      "Create a new task in the user's task list (canonical fields: task_name, task_priority, task_category, task_deadline, task_deadline_time, task_duration_hours).",
    inputSchema: {
      type: "object",
      required: ["task_name"],
      properties: {
        task_name: { type: "string" },
        task_priority: { type: "string" },
        task_category: { type: "string" },
        task_deadline: { type: "string" },
        task_deadline_time: { type: "string" },
        task_duration_hours: { type: "number" },
        computer_required: { type: "boolean" },
      },
    },
  },
  {
    name: "update_task",
    description: "Update an existing task by id (supports completing, renaming, changing deadline, etc.).",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
        task_name: { type: "string" },
        task_priority: { type: "string" },
        task_category: { type: "string" },
        task_deadline: { type: "string" },
        task_deadline_time: { type: "string" },
        task_duration_hours: { type: "number" },
        computer_required: { type: "boolean" },
        completed: { type: "boolean" },
      },
    },
  },
  {
    name: "delete_task",
    description: "Delete an existing task by id (only if the user explicitly asked to delete).",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string" } },
    },
  },
  {
    name: "add_habit",
    description: "Add a daily habit (name + time).",
    inputSchema: {
      type: "object",
      required: ["name", "time"],
      properties: {
        name: { type: "string" },
        time: { type: "string" },
        description: { type: "string" },
      },
    },
  },
  {
    name: "delete_habit",
    description: "Delete a daily habit by id.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string" } },
    },
  },
  {
    name: "rebalance_schedule",
    description:
      "Use the LLM to rebalance the user's schedule into time blocks for the next N days, respecting fixed blocks.",
    inputSchema: {
      type: "object",
      properties: {
        horizonDays: { type: "integer", default: 7, minimum: 1, maximum: 21 },
        maxHoursPerDay: { type: "number", default: 10, minimum: 1, maximum: 16 },
      },
    },
  },
  {
    name: "get_calendar_links",
    description: "Get calendar subscription links (subscribeUrl + webcalUrl).",
    inputSchema: { type: "object", properties: {} },
  },
];

async function aiRebalanceScheduleFromUserData({ data, horizonDays, maxHoursPerDay }) {
  const safeData = ensureAxisUserDataShape(data);
  const tasks = Array.isArray(safeData.tasks) ? safeData.tasks : [];
  const fixedBlocks = Array.isArray(safeData.fixedBlocks) ? safeData.fixedBlocks : [];
  const schedule = Array.isArray(safeData.schedule) ? safeData.schedule : [];
  const profile = safeData.profile && typeof safeData.profile === "object" ? safeData.profile : {};

  const tasksBrief = tasks
    .filter((t) => t && typeof t === "object" && typeof t.id === "string")
    .filter((t) => !t.completed)
    .slice(0, 350)
    .map((t) => ({
      id: t.id,
      name: String(t.task_name || "").slice(0, 140),
      priority: String(t.task_priority || ""),
      category: String(t.task_category || ""),
      deadline: `${t.task_deadline || ""}T${t.task_deadline_time || "23:59"}`,
      durationHours: Number(t.task_duration_hours || 0) || 0,
    }));

  const fixedBrief = fixedBlocks
    .filter((b) => b && typeof b === "object" && b.start && b.end)
    .slice(0, 500)
    .map((b) => ({
      start: b.start,
      end: b.end,
      label: String(b.label || b.kind || "Fixed").slice(0, 80),
      category: String(b.category || ""),
    }));

  const scheduleBrief = schedule
    .filter((b) => b && typeof b === "object" && b.start && b.end)
    .slice(0, 500)
    .map((b) => ({
      taskId: b.taskId || "",
      start: b.start,
      end: b.end,
    }));

  const profileBrief = (() => {
    if (!profile || typeof profile !== "object") return {};
    const keep = [
      "user_name",
      "user_age_group",
      "procrastinator_type",
      "preferred_work_style",
      "preferred_study_method",
      "most_productive_time",
      "is_procrastinator",
      "has_trouble_finishing",
      "productive_windows",
      "weekly_personal_time",
      "weekly_review_hours",
    ];
    const out = {};
    keep.forEach((k) => {
      if (profile[k] !== undefined) out[k] = profile[k];
    });
    return out;
  })();

  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);

  const userPrompt = `
Rebalance the user's schedule for the next ${horizonDays} days starting ${todayIso}.
Return JSON only: {"blocks":[{"taskId":"task-id","start":"ISO-8601 UTC","end":"ISO-8601 UTC","reason":"short"}]}.

Hard rules:
- "start" and "end" MUST be ISO-8601 timestamps in UTC with a trailing "Z".
- Do not create blocks that overlap fixedBlocks.
- Do not overlap your own blocks.
- Only use taskIds from the provided tasks list.
- Keep total scheduled work per day <= ${maxHoursPerDay} hours.
- Each block must be at least 15 minutes and end after start.

Soft rules:
- Prefer scheduling higher priority and earlier deadlines first.
- Split long tasks into multiple blocks, adding small buffers when reasonable.
- Use the user's focus preferences when provided in profile.

Tasks: ${JSON.stringify(tasksBrief).slice(0, 7000)}
Fixed blocks (unavailable): ${JSON.stringify(fixedBrief).slice(0, 7000)}
Current schedule (may be ignored): ${JSON.stringify(scheduleBrief).slice(0, 6000)}
Profile: ${JSON.stringify(profileBrief).slice(0, 2000)}
`.trim();

  const reply = await callLlm({
    system: "You are a time-blocking assistant. Return strict JSON only.",
    user: userPrompt,
    temperature: 0.25,
    maxTokens: 1200,
    expectJSON: true,
  });

  const parsed = safeParseJSON(reply) || {};
  const blocks = Array.isArray(parsed.blocks) ? parsed.blocks : [];
  if (!blocks.length) {
    throw new Error("AI returned no schedule blocks.");
  }

  const taskIdSet = new Set(tasksBrief.map((t) => t.id));
  const normalized = [];
  for (const b of blocks) {
    if (!b || typeof b !== "object") continue;
    if (!taskIdSet.has(b.taskId)) continue;
    const start = new Date(b.start);
    const end = new Date(b.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
    if (end <= start) continue;
    normalized.push({
      kind: "task",
      taskId: b.taskId,
      start: start.toISOString(),
      end: end.toISOString(),
    });
  }

  if (!normalized.length) {
    throw new Error("AI returned invalid schedule blocks.");
  }

  return normalized;
}

async function executeAssistantTool({ name, args, userId, data, req }) {
  const toolName = String(name || "").trim();
  const input = args && typeof args === "object" ? args : {};

  if (toolName === "get_snapshot") {
    return { snapshot: buildAssistantSnapshot(data) };
  }

  if (toolName === "list_tasks") {
    const includeCompleted = Boolean(input.includeCompleted);
    const safeData = ensureAxisUserDataShape(data);
    return {
      tasks: safeData.tasks
        .filter((t) => (includeCompleted ? true : !t?.completed))
        .slice(0, 500)
        .map((t) => ({
          id: t.id,
          task_name: t.task_name,
          task_priority: t.task_priority,
          task_category: t.task_category,
          task_deadline: t.task_deadline,
          task_deadline_time: t.task_deadline_time,
          task_duration_hours: t.task_duration_hours,
          completed: Boolean(t.completed),
        })),
    };
  }

  if (toolName === "create_task") {
    const parsed = taskCreateSchema.safeParse(input);
    if (!parsed.success) throw new Error("Invalid create_task arguments");
    const safeData = ensureAxisUserDataShape(data);
    const task = createAxisTask(parsed.data);
    safeData.tasks.push(task);
    data.tasks = safeData.tasks;
    return { task };
  }

  if (toolName === "update_task") {
    const parsed = assistantUpdateTaskSchema.safeParse(input);
    if (!parsed.success) throw new Error("Invalid update_task arguments");
    const safeData = ensureAxisUserDataShape(data);
    const idx = safeData.tasks.findIndex((t) => t && String(t.id) === parsed.data.id);
    if (idx < 0) throw new Error("Task not found");
    const task = safeData.tasks[idx] && typeof safeData.tasks[idx] === "object" ? safeData.tasks[idx] : {};

    const patch = parsed.data;
    if (patch.task_name !== undefined) task.task_name = String(patch.task_name || "").trim();
    if (patch.task_priority !== undefined) {
      const normalized = normalizeTaskPriority(patch.task_priority);
      if (normalized) task.task_priority = normalized;
    }
    if (patch.task_category !== undefined) task.task_category = normalizeTaskCategory(patch.task_category);
    if (patch.task_deadline !== undefined) task.task_deadline = String(patch.task_deadline || "").trim();
    if (patch.task_deadline_time !== undefined) task.task_deadline_time = String(patch.task_deadline_time || "23:59").trim();
    if (patch.task_duration_hours !== undefined) task.task_duration_hours = clampTaskDurationHours(patch.task_duration_hours);
    if (patch.computer_required !== undefined) task.computer_required = Boolean(patch.computer_required);
    if (patch.completed !== undefined) {
      task.completed = Boolean(patch.completed);
      task.completedAt = task.completed ? new Date().toISOString() : undefined;
    }
    task.updatedAt = new Date().toISOString();

    safeData.tasks[idx] = task;
    data.tasks = safeData.tasks;
    return { task };
  }

  if (toolName === "delete_task") {
    const parsed = assistantDeleteTaskSchema.safeParse(input);
    if (!parsed.success) throw new Error("Invalid delete_task arguments");
    const safeData = ensureAxisUserDataShape(data);
    const before = safeData.tasks.length;
    safeData.tasks = safeData.tasks.filter((t) => t && String(t.id) !== parsed.data.id);
    safeData.schedule = safeData.schedule.filter(
      (b) => !(b && b.kind === "task" && String(b.taskId) === parsed.data.id),
    );
    if (safeData.tasks.length === before) throw new Error("Task not found");
    data.tasks = safeData.tasks;
    data.schedule = safeData.schedule;
    return { success: true };
  }

  if (toolName === "add_habit") {
    const parsed = habitCreateSchema.safeParse(input);
    if (!parsed.success) throw new Error("Invalid add_habit arguments");
    const safeData = ensureAxisUserDataShape(data);
    const habit = {
      id: `habit_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`,
      name: String(parsed.data.name || "").trim(),
      time: String(parsed.data.time || "").trim(),
      description: String(parsed.data.description || "").trim(),
      createdAt: new Date().toISOString(),
    };
    safeData.dailyHabits.push(habit);
    data.dailyHabits = safeData.dailyHabits;
    return { habit };
  }

  if (toolName === "delete_habit") {
    const parsed = assistantDeleteHabitSchema.safeParse(input);
    if (!parsed.success) throw new Error("Invalid delete_habit arguments");
    const safeData = ensureAxisUserDataShape(data);
    const before = safeData.dailyHabits.length;
    safeData.dailyHabits = safeData.dailyHabits.filter((h) => h && String(h.id) !== parsed.data.id);
    if (safeData.dailyHabits.length === before) throw new Error("Habit not found");
    data.dailyHabits = safeData.dailyHabits;
    return { success: true };
  }

  if (toolName === "rebalance_schedule") {
    const parsed = assistantRebalanceSchema.safeParse(input);
    if (!parsed.success) throw new Error("Invalid rebalance_schedule arguments");
    const blocks = await aiRebalanceScheduleFromUserData({
      data,
      horizonDays: parsed.data.horizonDays,
      maxHoursPerDay: parsed.data.maxHoursPerDay,
    });
    data.schedule = blocks;
    data.lastRebalancedAt = new Date().toISOString();
    return { blocksAdded: blocks.length };
  }

  if (toolName === "get_calendar_links") {
    const token = await getOrCreateCalendarToken(userId);
    if (!token) throw new Error("User not found");
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const subscribeUrl = `${baseUrl}/api/calendar/subscribe/${token}.ics`;
    const webcalUrl = subscribeUrl.replace(/^https?:\/\//, "webcal://");
    return { token, subscribeUrl, webcalUrl };
  }

  throw new Error(`Unknown tool: ${toolName}`);
}

function buildAssistantPlannerPrompt({ message, snapshot }) {
  const toolsJson = JSON.stringify(ASSISTANT_TOOLS, null, 2);
  const snapshotJson = JSON.stringify(snapshot, null, 2);
  return `
You are an agent running inside Axis (a student planner). You can take actions via tools.

Rules:
- You MUST return strict JSON only matching: {"assistant_reply":"string","tool_calls":[{"name":"tool","arguments":{...}}]}.
- Only call tools from the provided tool list.
- If the user request is ambiguous, ask a clarifying question in assistant_reply and leave tool_calls empty.
- Never invent task or habit IDs; use snapshot/listed IDs.
- Do NOT delete anything unless the user explicitly asked.

User message:
${message}

Current user snapshot:
${snapshotJson}

Available tools (JSON):
${toolsJson}
`.trim();
}

function buildAssistantFinalPrompt({ message, toolResults }) {
  const resultsJson = JSON.stringify(toolResults, null, 2);
  return `
Return JSON only: {"reply":"..."}.

Write a concise, helpful response to the user. Summarize what you changed (if anything), and suggest the next best step.

User message:
${message}

Tool results:
${resultsJson}
`.trim();
}

app.get("/api/assistant/tools", authenticateToken, async (req, res) => {
  res.json({
    provider: SUPPORTED_LLM_PROVIDERS.has(LLM_PROVIDER) ? LLM_PROVIDER : "deepseek",
    tools: ASSISTANT_TOOLS,
  });
});

app.post(
  "/api/assistant/agent",
  authenticateToken,
  validateBody(assistantAgentRequestSchema),
  async (req, res) => {
    try {
      const userId = req.user.userId;
      const rawData = await getUserData(userId);
      if (!rawData) return res.status(404).json({ error: "User data not found" });

      const data = ensureAxisUserDataShape(rawData);
      const snapshot = buildAssistantSnapshot(data);
      const message = req.body.message;

      const planRaw = await callLlm({
        system:
          "You are Axis Assistant. Decide which tools to call. Return strict JSON only. Never include markdown fences.",
        user: buildAssistantPlannerPrompt({ message, snapshot }),
        temperature: 0.2,
        maxTokens: 900,
        expectJSON: true,
      });

      const planParsed = assistantPlannerResponseSchema.safeParse(safeParseJSON(planRaw));
      if (!planParsed.success) {
        return res.status(502).json({ error: "Assistant returned invalid JSON." });
      }

      const toolCalls = planParsed.data.tool_calls.slice(0, 6);
      const toolResults = [];
      let changed = false;

      for (const call of toolCalls) {
        const toolName = String(call?.name || "").trim();
        if (!toolName) continue;
        try {
          const result = await executeAssistantTool({
            name: toolName,
            args: call.arguments,
            userId,
            data,
            req,
          });
          toolResults.push({ name: toolName, ok: true, result });
          if (!["get_snapshot", "list_tasks", "get_calendar_links"].includes(toolName)) {
            changed = true;
          }
        } catch (err) {
          toolResults.push({ name: toolName, ok: false, error: err.message || String(err) });
        }
      }

      if (changed) {
        await saveUserData(userId, data);
      }

      if (!toolCalls.length) {
        return res.json({ reply: planParsed.data.assistant_reply, data });
      }

      const finalRaw = await callLlm({
        system:
          "You are Axis Assistant. Produce the final user-facing message. Return strict JSON only. Never include markdown fences.",
        user: buildAssistantFinalPrompt({ message, toolResults }),
        temperature: 0.25,
        maxTokens: 700,
        expectJSON: true,
      });

      const finalParsed = assistantFinalResponseSchema.safeParse(safeParseJSON(finalRaw));
      if (!finalParsed.success) {
        return res.json({
          reply: planParsed.data.assistant_reply,
          toolResults,
          data,
        });
      }

      res.json({ reply: finalParsed.data.reply, toolResults, data });
    } catch (err) {
      console.error("assistant agent error:", err);
      res.status(500).json({ error: err.message || "Assistant failed" });
    }
  },
);

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

    const reply = await callLlm({
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

    const reply = await callLlm({
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

    const reply = await callLlm({
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

app.post(
  "/api/ai/reschedule",
  authenticateToken,
  validateBody(aiRescheduleSchema),
  async (req, res) => {
    try {
      const {
        tasks = [],
        fixedBlocks = [],
        schedule = [],
        profile = {},
        horizonDays = 7,
        maxHoursPerDay = 10,
      } = req.body || {};

      const tasksBrief = tasks
        .filter((t) => t && typeof t === "object" && typeof t.id === "string")
        .filter((t) => !t.completed)
        .slice(0, 350)
        .map((t) => ({
          id: t.id,
          name: String(t.task_name || "").slice(0, 140),
          priority: String(t.task_priority || ""),
          category: String(t.task_category || ""),
          deadline: `${t.task_deadline || ""}T${t.task_deadline_time || "23:59"}`,
          durationHours: Number(t.task_duration_hours || 0) || 0,
        }));

      const fixedBrief = fixedBlocks
        .filter((b) => b && typeof b === "object" && b.start && b.end)
        .slice(0, 500)
        .map((b) => ({
          start: b.start,
          end: b.end,
          label: String(b.label || b.kind || "Fixed").slice(0, 80),
          category: String(b.category || ""),
        }));

      const scheduleBrief = schedule
        .filter((b) => b && typeof b === "object" && b.start && b.end)
        .slice(0, 500)
        .map((b) => ({
          taskId: b.taskId || "",
          start: b.start,
          end: b.end,
        }));

      const profileBrief = (() => {
        if (!profile || typeof profile !== "object") return {};
        const keep = [
          "procrastinator_type",
          "preferred_work_style",
          "preferred_study_method",
          "most_productive_time",
          "is_procrastinator",
          "has_trouble_finishing",
          "productive_windows",
        ];
        const out = {};
        keep.forEach((k) => {
          if (profile[k] !== undefined) out[k] = profile[k];
        });
        return out;
      })();

      const today = new Date();
      const todayIso = today.toISOString().slice(0, 10);

      const userPrompt = `
Rebalance the user's schedule for the next ${horizonDays} days starting ${todayIso}.
Return JSON only: {"blocks":[{"taskId":"task-id","start":"ISO-8601 UTC","end":"ISO-8601 UTC","reason":"short"}]}.

Hard rules:
- "start" and "end" MUST be ISO-8601 timestamps in UTC with a trailing "Z", e.g. "2026-01-05T14:00:00Z".
- Do not create blocks that overlap fixedBlocks.
- Do not overlap your own blocks.
- Only use taskIds from the provided tasks list.
- Keep total scheduled work per day <= ${maxHoursPerDay} hours.
- Each block must be at least 15 minutes and end after start.

Soft rules:
- Prefer scheduling higher priority and earlier deadlines first.
- Split long tasks into multiple blocks, adding small buffers when reasonable.
- Use the user's focus preferences when provided in profile.

Tasks: ${JSON.stringify(tasksBrief).slice(0, 7000)}
Fixed blocks (unavailable): ${JSON.stringify(fixedBrief).slice(0, 7000)}
Current schedule (may be ignored): ${JSON.stringify(scheduleBrief).slice(0, 6000)}
Profile: ${JSON.stringify(profileBrief).slice(0, 2000)}
`.trim();

      const reply = await callLlm({
        system: "You are a time-blocking assistant. Return strict JSON only.",
        user: userPrompt,
        temperature: 0.25,
        maxTokens: 1200,
        expectJSON: true,
      });

      const parsed = safeParseJSON(reply) || {};
      const blocks = Array.isArray(parsed.blocks) ? parsed.blocks : [];
      if (!blocks.length) {
        return res.status(502).json({ error: "AI returned no schedule blocks." });
      }

      // Basic validation (client also validates). Reject if nothing survives.
      const taskIdSet = new Set(tasksBrief.map((t) => t.id));
      const normalized = [];
      for (const b of blocks) {
        if (!b || typeof b !== "object") continue;
        if (!taskIdSet.has(b.taskId)) continue;
        const start = new Date(b.start);
        const end = new Date(b.end);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
        if (end <= start) continue;
        normalized.push({
          taskId: b.taskId,
          start: start.toISOString(),
          end: end.toISOString(),
          reason: typeof b.reason === "string" ? b.reason.slice(0, 140) : "",
        });
      }

      if (!normalized.length) {
        return res.status(502).json({ error: "AI returned invalid schedule blocks." });
      }

      res.json({ blocks: normalized });
    } catch (err) {
      console.error("reschedule error:", err);
      res.status(500).json({ error: err.message || "Reschedule failed" });
    }
  },
);

app.post("/api/ai/reflection-summary", authenticateToken, async (req, res) => {
  try {
    const { reflections = [], goals = [] } = req.body || {};
    const userPrompt = `
Summarize the recent reflections and suggest a weekly focus.
Return JSON only: {"summary":"2-3 bullet sentences","focus":"one theme","habit":"one small habit","risk":"one risk to watch"}
Reflections: ${JSON.stringify(reflections).slice(0, 5000)}
Goals: ${JSON.stringify(goals).slice(0, 3000)}
`.trim();

    const reply = await callLlm({
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

    const reply = await callLlm({
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

    const reply = await callLlm({
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

    const reply = await callLlm({
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

    const reply = await callLlm({
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
