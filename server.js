// Simple Node/Express backend for Axis chatbot using DeepSeek API
// IMPORTANT: Do NOT hard-code your API key here. Use the DEEPSEEK_API_KEY environment variable.

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

async function generateAiRescheduleBlocks({
  tasks = [],
  fixedBlocks = [],
  schedule = [],
  profile = {},
  horizonDays = 7,
  maxHoursPerDay = 10,
}) {
  const tasksBrief = ensureArray(tasks)
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

  const fixedBrief = ensureArray(fixedBlocks)
    .filter((b) => b && typeof b === "object" && b.start && b.end)
    .slice(0, 500)
    .map((b) => ({
      start: b.start,
      end: b.end,
      label: String(b.label || b.kind || "Fixed").slice(0, 80),
      category: String(b.category || ""),
    }));

  const scheduleBrief = ensureArray(schedule)
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

  const reply = await callDeepSeek({
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
    throw new Error("AI returned invalid schedule blocks.");
  }

  return normalized;
}

function summarizeUserDataForAssistant(data) {
  const profile = data?.profile && typeof data.profile === "object" ? data.profile : {};

  const tasks = ensureArray(data?.tasks)
    .slice(0, 120)
    .map((t) => ({
      id: String(t?.id || ""),
      task_name: String(t?.task_name || ""),
      task_priority: String(t?.task_priority || ""),
      task_category: String(t?.task_category || ""),
      task_deadline: String(t?.task_deadline || ""),
      task_deadline_time: String(t?.task_deadline_time || ""),
      task_duration_hours: Number.isFinite(Number(t?.task_duration_hours))
        ? Number(t.task_duration_hours)
        : null,
      completed: !!t?.completed,
    }))
    .filter((t) => t.id && t.task_name);

  const dailyHabits = ensureArray(data?.dailyHabits)
    .slice(0, 80)
    .map((h) => ({
      id: String(h?.id || ""),
      name: String(h?.name || ""),
      time: String(h?.time || ""),
    }))
    .filter((h) => h.id && h.name);

  return {
    profile: {
      user_name: profile?.user_name || profile?.name || "",
      user_age_group: profile?.user_age_group || "",
    },
    tasks,
    dailyHabits,
  };
}

function clampNumber(value, { min, max }) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, n));
}

function formatAssistantReply({ reply, plan, actions }) {
  let out = String(reply || "").trim();
  const planLines = Array.isArray(plan) ? plan.map((p) => String(p || "").trim()).filter(Boolean) : [];
  const actionLines = Array.isArray(actions)
    ? actions.map((a) => String(a || "").trim()).filter(Boolean)
    : [];

  if (planLines.length) {
    out += `${out ? "\n\n" : ""}Plan:\n${planLines.map((p) => `- ${p}`).join("\n")}`;
  }
  if (actionLines.length) {
    out += `${out ? "\n\n" : ""}Actions:\n${actionLines.map((a) => `- ${a}`).join("\n")}`;
  }
  return out || "Done.";
}

async function runAxisAssistantAgent({ userId, message }) {
  const originalMessage = String(message || "").trim();
  if (!originalMessage) {
    return { reply: "What would you like me to help with?", plan: [], actions: [], data: null };
  }

  const loaded = await getUserData(userId);
  if (!loaded) {
    throw new Error("User data not found.");
  }
  const data = normalizeUserDataState(loaded);

  const actions = [];
  const toolResults = [];

  const tools = {
    add_task: async (args) => {
      const raw = args && typeof args === "object" ? args : {};
      const parsed = createTaskSchema.safeParse({
        task_name: raw.task_name || raw.name || raw.title || "",
        task_priority: raw.task_priority || raw.priority,
        task_category: raw.task_category || raw.category,
        task_deadline: raw.task_deadline || raw.deadline || "",
        task_deadline_time: raw.task_deadline_time || raw.deadline_time || raw.deadlineTime || "23:59",
        task_duration_hours: clampNumber(
          raw.task_duration_hours ?? raw.duration_hours ?? raw.durationHours,
          { min: 0, max: 80 },
        ),
      });

      if (!parsed.success) {
        return { ok: false, error: "Invalid arguments for add_task." };
      }

      const newTask = {
        ...parsed.data,
        id: `task_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        completed: false,
        order: getNextTaskOrder(data.tasks),
      };
      data.tasks.push(newTask);
      actions.push(`Added task "${newTask.task_name}"`);
      return { ok: true, task: newTask };
    },

    complete_task: async (args) => {
      const raw = args && typeof args === "object" ? args : {};
      const taskId = String(raw.taskId || raw.id || raw.task_id || "").trim();
      const query = String(raw.query || raw.task_name || raw.name || "").trim();

      let task = null;
      if (taskId) {
        task = data.tasks.find((t) => t?.id === taskId) || null;
      } else if (query) {
        task = findItemByQuery(data.tasks, query, (t) => t?.task_name);
      }

      if (!task) {
        return { ok: false, error: "Task not found. Provide taskId or a unique task name." };
      }

      task.completed = true;
      task.completedAt = new Date().toISOString();
      actions.push(`Completed task "${task.task_name}"`);
      return { ok: true, taskId: task.id };
    },

    delete_task: async (args) => {
      const raw = args && typeof args === "object" ? args : {};
      const taskId = String(raw.taskId || raw.id || raw.task_id || "").trim();
      const query = String(raw.query || raw.task_name || raw.name || "").trim();

      let idToDelete = taskId;
      if (!idToDelete && query) {
        const task = findItemByQuery(data.tasks, query, (t) => t?.task_name);
        if (task) idToDelete = task.id;
      }

      if (!idToDelete) {
        return { ok: false, error: "Task not found. Provide taskId or a unique task name." };
      }

      const before = data.tasks.length;
      data.tasks = data.tasks.filter((t) => t?.id !== idToDelete);
      if (data.tasks.length === before) {
        return { ok: false, error: "Task not found." };
      }

      actions.push(`Deleted task ${idToDelete}`);
      return { ok: true };
    },

    add_habit: async (args) => {
      const raw = args && typeof args === "object" ? args : {};
      const parsed = createHabitSchema.safeParse({
        name: raw.name || raw.habit || raw.title || "",
        time: raw.time || raw.when || "",
        description: raw.description || "",
      });

      if (!parsed.success) {
        return { ok: false, error: "Invalid arguments for add_habit." };
      }

      const habit = {
        id: `habit_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        name: parsed.data.name,
        time: parsed.data.time,
        description: parsed.data.description || "",
      };
      data.dailyHabits.push(habit);
      actions.push(`Added habit "${habit.name}" at ${habit.time}`);
      return { ok: true, habit };
    },

    delete_habit: async (args) => {
      const raw = args && typeof args === "object" ? args : {};
      const habitId = String(raw.habitId || raw.id || raw.habit_id || "").trim();
      const query = String(raw.query || raw.name || raw.habit || "").trim();

      let idToDelete = habitId;
      if (!idToDelete && query) {
        const habit = findItemByQuery(data.dailyHabits, query, (h) => h?.name);
        if (habit) idToDelete = habit.id;
      }

      if (!idToDelete) {
        return { ok: false, error: "Habit not found. Provide habitId or a unique habit name." };
      }

      const before = data.dailyHabits.length;
      data.dailyHabits = data.dailyHabits.filter((h) => h?.id !== idToDelete);
      if (data.dailyHabits.length === before) {
        return { ok: false, error: "Habit not found." };
      }

      actions.push(`Deleted habit ${idToDelete}`);
      return { ok: true };
    },

    rebalance_week: async (args) => {
      const raw = args && typeof args === "object" ? args : {};
      const horizonDays = Number.isFinite(Number(raw.horizonDays))
        ? Math.max(1, Math.min(21, Math.round(Number(raw.horizonDays))))
        : 7;
      const maxHoursPerDay = Number.isFinite(Number(raw.maxHoursPerDay))
        ? Math.max(1, Math.min(16, Math.round(Number(raw.maxHoursPerDay))))
        : 10;

      if (!data.profile) {
        return { ok: false, error: "Profile is missing; complete onboarding before rebalancing." };
      }

      const blocks = await generateAiRescheduleBlocks({
        tasks: ensureArray(data.tasks).filter((t) => !t?.completed),
        fixedBlocks: ensureArray(data.fixedBlocks),
        schedule: ensureArray(data.schedule),
        profile: data.profile || {},
        horizonDays,
        maxHoursPerDay,
      });

      data.schedule = blocks.map((b) => ({
        kind: "task",
        taskId: b.taskId,
        start: b.start,
        end: b.end,
      }));

      actions.push(`Rebalanced schedule for ${horizonDays} days`);
      return { ok: true, blocks: data.schedule };
    },
  };

  const toolDocs = [
    {
      name: "add_task",
      input: {
        task_name: "string (required)",
        task_priority: `"Urgent & Important" | "Urgent, Not Important" | "Important, Not Urgent" | "Not Urgent & Not Important" (optional)`,
        task_category: "string (optional)",
        task_deadline: "YYYY-MM-DD (optional)",
        task_deadline_time: "HH:MM (optional)",
        task_duration_hours: "number (optional)",
      },
    },
    { name: "complete_task", input: { taskId: "string (optional)", query: "string (optional)" } },
    { name: "delete_task", input: { taskId: "string (optional)", query: "string (optional)" } },
    { name: "add_habit", input: { name: "string (required)", time: "string (required)", description: "string (optional)" } },
    { name: "delete_habit", input: { habitId: "string (optional)", query: "string (optional)" } },
    { name: "rebalance_week", input: { horizonDays: "number (optional)", maxHoursPerDay: "number (optional)" } },
  ];

  const systemPrompt =
    "You are Axis Assistant, an agentic study planner. " +
    "You can create/complete/delete tasks and add/delete daily habits using the provided tools. " +
    "Always return strict JSON only, no markdown, no extra text.\n" +
    "When you need to perform an action, respond with: " +
    '{"type":"tool","tool":"tool_name","args":{...}}.\n' +
    "When you are done, respond with: " +
    '{"type":"final","reply":"...","plan":["..."],"notes":["..."]}.\n' +
    "Keep plan short (<= 6 items). If you need clarification, ask in reply.";

  for (let step = 0; step < 6; step += 1) {
    const context = summarizeUserDataForAssistant(data);
    const userPrompt = [
      `User data (summary): ${JSON.stringify(context)}`,
      `Available tools: ${JSON.stringify(toolDocs)}`,
      toolResults.length ? `Tool results so far: ${JSON.stringify(toolResults)}` : "",
      `User message: ${originalMessage}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const raw = await callDeepSeek({
      system: systemPrompt,
      user: userPrompt,
      temperature: 0.2,
      maxTokens: 900,
      expectJSON: true,
    });

    const parsed = safeParseJSON(raw);
    if (!parsed || typeof parsed !== "object") {
      toolResults.push({ ok: false, error: "Assistant returned invalid JSON." });
      continue;
    }

    if (parsed.type === "tool") {
      const toolName = String(parsed.tool || "").trim();
      const handler = tools[toolName];
      if (!handler) {
        toolResults.push({ ok: false, error: `Unknown tool: ${toolName}` });
        continue;
      }

      const result = await handler(parsed.args);
      toolResults.push({ tool: toolName, ...result });
      continue;
    }

    if (parsed.type === "final") {
      const plan = Array.isArray(parsed.plan) ? parsed.plan : [];
      const replyText = formatAssistantReply({ reply: parsed.reply, plan, actions });
      await saveUserData(userId, data);
      return { reply: replyText, plan, actions, data };
    }

    toolResults.push({ ok: false, error: "Assistant returned unknown response type." });
  }

  await saveUserData(userId, data);
  return {
    reply:
      "I couldn’t finish that request safely. Try rephrasing, or ask me to do one specific action (e.g., “add a task called … due …”).",
    plan: [],
    actions,
    data,
  };
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

const taskPrioritySchema = z.enum([
  "Urgent & Important",
  "Urgent, Not Important",
  "Important, Not Urgent",
  "Not Urgent & Not Important",
]);

const createTaskSchema = z.object({
  task_name: z.string().min(1).max(200),
  task_priority: taskPrioritySchema.optional().default("Important, Not Urgent"),
  task_category: z.string().min(1).max(80).optional().default("study"),
  task_deadline: z.string().max(30).optional().default(""),
  task_deadline_time: z.string().max(10).optional().default("23:59"),
  task_duration_hours: z.number().min(0).max(80).optional().nullable().default(null),
});

const updateTaskSchema = z.object({
  task_name: z.string().min(1).max(200).optional(),
  task_priority: taskPrioritySchema.optional(),
  task_category: z.string().min(1).max(80).optional(),
  task_deadline: z.string().max(30).optional(),
  task_deadline_time: z.string().max(10).optional(),
  task_duration_hours: z.number().min(0).max(80).optional().nullable(),
  completed: z.boolean().optional(),
});

const createHabitSchema = z.object({
  name: z.string().min(1).max(120),
  time: z.string().min(1).max(40),
  description: z.string().max(300).optional().default(""),
});

const assistantMessageSchema = z.object({
  message: z.string().min(1).max(4000),
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

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeUserDataState(data) {
  if (!data || typeof data !== "object") data = {};
  return {
    ...data,
    profile: data.profile ?? null,
    tasks: ensureArray(data.tasks),
    rankedTasks: ensureArray(data.rankedTasks),
    schedule: ensureArray(data.schedule),
    fixedBlocks: ensureArray(data.fixedBlocks),
    goals: ensureArray(data.goals),
    reflections: ensureArray(data.reflections),
    blockingRules: ensureArray(data.blockingRules),
    dailyHabits: ensureArray(data.dailyHabits),
  };
}

function getNextTaskOrder(tasks) {
  const safeTasks = ensureArray(tasks);
  const maxOrder = safeTasks.reduce((max, t) => {
    const value = Number(t?.order);
    return Number.isFinite(value) ? Math.max(max, value) : max;
  }, 0);
  return maxOrder + 1;
}

function findItemByQuery(items, query, getName) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return null;
  const matches = ensureArray(items).filter((item) => {
    const name = String(getName(item) || "").toLowerCase();
    return name.includes(q);
  });
  if (matches.length === 1) return matches[0];
  return null;
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

// ---------- Task & Habit REST endpoints ----------

app.get("/api/tasks", authenticateToken, async (req, res) => {
  try {
    const data = normalizeUserDataState(await getUserData(req.user.userId));
    res.json({ tasks: data.tasks });
  } catch (err) {
    console.error("Get tasks error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post(
  "/api/tasks",
  authenticateToken,
  validateBody(createTaskSchema),
  async (req, res) => {
    try {
      const data = normalizeUserDataState(await getUserData(req.user.userId));
      const newTask = {
        ...req.body,
        id: `task_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        completed: false,
        order: getNextTaskOrder(data.tasks),
      };
      data.tasks.push(newTask);
      await saveUserData(req.user.userId, data);
      res.status(201).json({ task: newTask });
    } catch (err) {
      console.error("Create task error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

app.patch(
  "/api/tasks/:id",
  authenticateToken,
  validateBody(updateTaskSchema),
  async (req, res) => {
    try {
      const taskId = String(req.params.id || "").trim();
      if (!taskId) return res.status(400).json({ error: "Missing task id" });

      const data = normalizeUserDataState(await getUserData(req.user.userId));
      const idx = data.tasks.findIndex((t) => t?.id === taskId);
      if (idx === -1) return res.status(404).json({ error: "Task not found" });

      data.tasks[idx] = { ...data.tasks[idx], ...req.body, id: taskId };
      await saveUserData(req.user.userId, data);
      res.json({ task: data.tasks[idx] });
    } catch (err) {
      console.error("Update task error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

app.delete("/api/tasks/:id", authenticateToken, async (req, res) => {
  try {
    const taskId = String(req.params.id || "").trim();
    if (!taskId) return res.status(400).json({ error: "Missing task id" });

    const data = normalizeUserDataState(await getUserData(req.user.userId));
    const before = data.tasks.length;
    data.tasks = data.tasks.filter((t) => t?.id !== taskId);
    if (data.tasks.length === before) return res.status(404).json({ error: "Task not found" });

    await saveUserData(req.user.userId, data);
    res.json({ success: true });
  } catch (err) {
    console.error("Delete task error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/habits", authenticateToken, async (req, res) => {
  try {
    const data = normalizeUserDataState(await getUserData(req.user.userId));
    res.json({ dailyHabits: data.dailyHabits });
  } catch (err) {
    console.error("Get habits error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post(
  "/api/habits",
  authenticateToken,
  validateBody(createHabitSchema),
  async (req, res) => {
    try {
      const data = normalizeUserDataState(await getUserData(req.user.userId));
      const habit = {
        id: `habit_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        name: req.body.name,
        time: req.body.time,
        description: req.body.description || "",
      };
      data.dailyHabits.push(habit);
      await saveUserData(req.user.userId, data);
      res.status(201).json({ habit });
    } catch (err) {
      console.error("Create habit error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

app.delete("/api/habits/:id", authenticateToken, async (req, res) => {
  try {
    const habitId = String(req.params.id || "").trim();
    if (!habitId) return res.status(400).json({ error: "Missing habit id" });

    const data = normalizeUserDataState(await getUserData(req.user.userId));
    const before = data.dailyHabits.length;
    data.dailyHabits = data.dailyHabits.filter((h) => h?.id !== habitId);
    if (data.dailyHabits.length === before) return res.status(404).json({ error: "Habit not found" });

    await saveUserData(req.user.userId, data);
    res.json({ success: true });
  } catch (err) {
    console.error("Delete habit error:", err);
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

app.post(
  "/api/ai/reschedule",
  authenticateToken,
  validateBody(aiRescheduleSchema),
  async (req, res) => {
    try {
      const blocks = await generateAiRescheduleBlocks(req.body || {});
      res.json({ blocks });
    } catch (err) {
      console.error("reschedule error:", err);
      const msg = err?.message || "Reschedule failed";
      const status = String(msg).toLowerCase().includes("ai returned") ? 502 : 500;
      res.status(status).json({ error: msg });
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

app.post(
  "/api/assistant",
  authenticateToken,
  validateBody(assistantMessageSchema),
  async (req, res) => {
    try {
      const result = await runAxisAssistantAgent({
        userId: req.user.userId,
        message: req.body.message,
      });
      res.json(result);
    } catch (err) {
      console.error("Error in /api/assistant:", err);
      res.status(500).json({ error: err.message || "Assistant failed." });
    }
  },
);

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
