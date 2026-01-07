#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const USER_DATA_DIR = path.join(process.cwd(), "user_data");
const userId = String(process.env.AXIS_MCP_USER_ID || "").trim();

if (!userId) {
  console.error("AXIS_MCP_USER_ID is required (e.g. export AXIS_MCP_USER_ID=user_123...)");
  process.exit(1);
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

async function readUserData() {
  const filePath = path.join(USER_DATA_DIR, `${userId}.json`);
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") return {};
  return parsed;
}

async function writeUserData(data) {
  await fs.mkdir(USER_DATA_DIR, { recursive: true });
  const filePath = path.join(USER_DATA_DIR, `${userId}.json`);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

function asToolText(obj) {
  return { content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] };
}

function writeJsonRpc(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function writeResult(id, result) {
  writeJsonRpc({ jsonrpc: "2.0", id, result });
}

function writeError(id, code, message, data) {
  writeJsonRpc({
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      ...(data !== undefined ? { data } : {}),
    },
  });
}

const tools = [
  {
    name: "axis_get_user_data",
    description: "Get the current Axis user_data JSON (configured by AXIS_MCP_USER_ID).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "axis_list_tasks",
    description: "List tasks for the configured Axis user.",
    inputSchema: {
      type: "object",
      properties: { includeCompleted: { type: "boolean", default: false } },
      additionalProperties: false,
    },
  },
  {
    name: "axis_add_task",
    description: "Add a task to Axis.",
    inputSchema: {
      type: "object",
      properties: {
        task_name: { type: "string" },
        task_priority: { type: "string" },
        task_category: { type: "string" },
        task_deadline: { type: "string" },
        task_deadline_time: { type: "string" },
        task_duration_hours: { type: "number" },
      },
      required: ["task_name"],
      additionalProperties: false,
    },
  },
  {
    name: "axis_complete_task",
    description: "Mark a task complete (by id).",
    inputSchema: {
      type: "object",
      properties: { taskId: { type: "string" } },
      required: ["taskId"],
      additionalProperties: false,
    },
  },
  {
    name: "axis_delete_task",
    description: "Delete a task (by id).",
    inputSchema: {
      type: "object",
      properties: { taskId: { type: "string" } },
      required: ["taskId"],
      additionalProperties: false,
    },
  },
  {
    name: "axis_list_habits",
    description: "List daily habits for the configured Axis user.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "axis_add_habit",
    description: "Add a daily habit to Axis.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        time: { type: "string" },
        description: { type: "string" },
      },
      required: ["name", "time"],
      additionalProperties: false,
    },
  },
  {
    name: "axis_delete_habit",
    description: "Delete a daily habit (by id).",
    inputSchema: {
      type: "object",
      properties: { habitId: { type: "string" } },
      required: ["habitId"],
      additionalProperties: false,
    },
  },
];

let initialized = false;
let protocolVersion = "2024-11-05";

async function handleInitialize(id, params) {
  protocolVersion = String(params?.protocolVersion || protocolVersion);
  initialized = true;
  writeResult(id, {
    protocolVersion,
    capabilities: { tools: {} },
    serverInfo: { name: "axis-mcp", version: "0.1.0" },
  });
}

async function handleToolsList(id) {
  if (!initialized) return writeError(id, -32002, "Server not initialized");
  writeResult(id, { tools });
}

async function handleToolsCall(id, params) {
  if (!initialized) return writeError(id, -32002, "Server not initialized");
  const toolName = String(params?.name || "").trim();
  const args = params?.arguments || {};

  try {
    if (toolName === "axis_get_user_data") {
      const data = await readUserData();
      return writeResult(id, asToolText({ userId, data }));
    }

    if (toolName === "axis_list_tasks") {
      const includeCompleted = !!args.includeCompleted;
      const data = normalizeUserDataState(await readUserData());
      const tasks = includeCompleted ? data.tasks : data.tasks.filter((t) => !t?.completed);
      return writeResult(id, asToolText({ userId, tasks }));
    }

    if (toolName === "axis_add_task") {
      const data = normalizeUserDataState(await readUserData());
      const taskName = String(args.task_name || "").trim();
      if (!taskName) return writeResult(id, asToolText({ ok: false, error: "task_name is required" }));

      const task = {
        id: `task_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        task_name: taskName,
        task_priority: String(args.task_priority || "Important, Not Urgent"),
        task_category: String(args.task_category || "study"),
        task_deadline: String(args.task_deadline || ""),
        task_deadline_time: String(args.task_deadline_time || "23:59"),
        task_duration_hours: typeof args.task_duration_hours === "number" ? args.task_duration_hours : null,
        completed: false,
        order: getNextTaskOrder(data.tasks),
      };
      data.tasks.push(task);
      await writeUserData(data);
      return writeResult(id, asToolText({ ok: true, task }));
    }

    if (toolName === "axis_complete_task") {
      const data = normalizeUserDataState(await readUserData());
      const taskId = String(args.taskId || "").trim();
      const task = data.tasks.find((t) => t?.id === taskId);
      if (!task) return writeResult(id, asToolText({ ok: false, error: "Task not found" }));
      task.completed = true;
      task.completedAt = new Date().toISOString();
      await writeUserData(data);
      return writeResult(id, asToolText({ ok: true, taskId }));
    }

    if (toolName === "axis_delete_task") {
      const data = normalizeUserDataState(await readUserData());
      const taskId = String(args.taskId || "").trim();
      const before = data.tasks.length;
      data.tasks = data.tasks.filter((t) => t?.id !== taskId);
      if (data.tasks.length === before) return writeResult(id, asToolText({ ok: false, error: "Task not found" }));
      await writeUserData(data);
      return writeResult(id, asToolText({ ok: true }));
    }

    if (toolName === "axis_list_habits") {
      const data = normalizeUserDataState(await readUserData());
      return writeResult(id, asToolText({ userId, dailyHabits: data.dailyHabits }));
    }

    if (toolName === "axis_add_habit") {
      const data = normalizeUserDataState(await readUserData());
      const name = String(args.name || "").trim();
      const time = String(args.time || "").trim();
      if (!name || !time) return writeResult(id, asToolText({ ok: false, error: "name and time are required" }));

      const habit = {
        id: `habit_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        name,
        time,
        description: String(args.description || ""),
      };
      data.dailyHabits.push(habit);
      await writeUserData(data);
      return writeResult(id, asToolText({ ok: true, habit }));
    }

    if (toolName === "axis_delete_habit") {
      const data = normalizeUserDataState(await readUserData());
      const habitId = String(args.habitId || "").trim();
      const before = data.dailyHabits.length;
      data.dailyHabits = data.dailyHabits.filter((h) => h?.id !== habitId);
      if (data.dailyHabits.length === before) return writeResult(id, asToolText({ ok: false, error: "Habit not found" }));
      await writeUserData(data);
      return writeResult(id, asToolText({ ok: true }));
    }

    return writeResult(id, asToolText({ ok: false, error: `Unknown tool: ${toolName}` }));
  } catch (err) {
    return writeError(id, -32000, "Tool execution failed", { message: err?.message || String(err) });
  }
}

async function dispatch(message) {
  const method = String(message?.method || "");
  const id = message?.id;
  const params = message?.params;

  // Notifications have no id; acknowledge nothing.
  if (method === "initialized") return;

  if (method === "ping") return writeResult(id, {});
  if (method === "initialize") return handleInitialize(id, params);
  if (method === "tools/list") return handleToolsList(id);
  if (method === "tools/call") return handleToolsCall(id, params);

  if (id !== undefined) {
    writeError(id, -32601, `Method not found: ${method}`);
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 1);
    const trimmed = line.trim();
    if (!trimmed) continue;
    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      continue;
    }
    dispatch(message);
  }
});

process.stdin.on("end", () => {
  process.exit(0);
});
