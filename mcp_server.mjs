/**
 * Axis MCP Server
 * 
 * A Model Context Protocol server that exposes Axis productivity tools
 * for AI assistants to interact with tasks, goals, habits, schedule, and reflections.
 * 
 * Features:
 * - Full CRUD operations for tasks, goals, and habits
 * - Schedule management and calendar integration
 * - Reflection and analytics access
 * - Input validation and structured error handling
 * - Resource endpoints for read-only data access
 * 
 * Environment Variables:
 * - AXIS_API_BASE_URL: Base URL for the Axis API (default: http://localhost:3000)
 * - AXIS_API_TOKEN: JWT token for authentication (required)
 * 
 * @version 0.2.0
 */

import process from "process";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// ============================================================================
// Configuration
// ============================================================================

/**
 * Normalize bearer token by removing "Bearer " prefix if present
 */
function normalizeBearerToken(token) {
  if (!token) return "";
  return String(token).trim().replace(/^Bearer\s+/i, "");
}

const AXIS_API_BASE_URL = String(
  process.env.AXIS_API_BASE_URL || "http://localhost:3000"
).replace(/\/+$/, "");

const AXIS_API_TOKEN = normalizeBearerToken(process.env.AXIS_API_TOKEN);

const SERVER_NAME = "axis-mcp";
const SERVER_VERSION = "0.2.0";

// ============================================================================
// API Utilities
// ============================================================================

/**
 * Generate authorization headers for API requests
 */
function axisAuthHeaders() {
  if (!AXIS_API_TOKEN) return {};
  return { Authorization: `Bearer ${AXIS_API_TOKEN}` };
}

/**
 * Make an authenticated request to the Axis API
 * @param {string} path - API endpoint path
 * @param {object} options - Fetch options
 * @returns {Promise<any>} - Parsed JSON response
 * @throws {Error} - If the request fails or returns an error
 */
async function axisFetchJson(path, options = {}) {
  const url = `${AXIS_API_BASE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
  
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
      ...axisAuthHeaders(),
    },
  });

  const text = await res.text();
  const json = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const msg = json?.error || json?.message || `Axis API error (${res.status})`;
    const error = new Error(msg);
    error.statusCode = res.status;
    error.response = json;
    throw error;
  }

  return json;
}

/**
 * Validate required string fields
 * @param {object} args - Arguments object
 * @param {string[]} fields - Required field names
 * @throws {Error} - If any required field is missing or empty
 */
function validateRequired(args, fields) {
  for (const field of fields) {
    const value = args?.[field];
    if (value === undefined || value === null || String(value).trim() === "") {
      throw new Error(`Missing required field: ${field}`);
    }
  }
}

/**
 * Validate that a value is a valid ISO date string
 * @param {string} value - Date string to validate
 * @param {string} fieldName - Field name for error message
 * @throws {Error} - If the date is invalid
 */
function validateDate(value, fieldName) {
  if (!value) return;
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date format for ${fieldName}: ${value}`);
  }
}

/**
 * Validate that a value is a positive number
 * @param {number} value - Number to validate
 * @param {string} fieldName - Field name for error message
 * @throws {Error} - If the number is invalid
 */
function validatePositiveNumber(value, fieldName) {
  if (value === undefined || value === null) return;
  const num = Number(value);
  if (isNaN(num) || num < 0) {
    throw new Error(`${fieldName} must be a positive number`);
  }
}

// ============================================================================
// Tool Definitions
// ============================================================================

const tools = [
  // ---------- Tasks ----------
  {
    name: "axis_list_tasks",
    description: "List all tasks from Axis. Returns tasks with their IDs, names, priorities, categories, deadlines, and completion status.",
    inputSchema: {
      type: "object",
      properties: {
        completed: {
          type: "boolean",
          description: "Filter by completion status (true/false). Omit to get all tasks.",
        },
        category: {
          type: "string",
          description: "Filter by category (study, project, chores, personal, social).",
        },
      },
    },
  },
  {
    name: "axis_create_task",
    description: "Create a new task in Axis. Use Eisenhower matrix priority (urgent/important combinations).",
    inputSchema: {
      type: "object",
      required: ["task_name"],
      properties: {
        task_name: {
          type: "string",
          description: "Name/description of the task.",
        },
        task_priority: {
          type: "string",
          enum: [
            "Urgent & Important",
            "Important, Not Urgent",
            "Urgent, Not Important",
            "Not Urgent & Not Important",
          ],
          description: "Eisenhower matrix priority level.",
        },
        task_category: {
          type: "string",
          enum: ["study", "project", "chores", "personal", "social"],
          description: "Task category.",
        },
        task_deadline: {
          type: "string",
          description: "Deadline date in YYYY-MM-DD format.",
        },
        task_deadline_time: {
          type: "string",
          description: "Deadline time in HH:MM format (24-hour).",
        },
        task_duration_hours: {
          type: "number",
          description: "Estimated duration in hours.",
        },
        computer_required: {
          type: "boolean",
          description: "Whether the task requires a computer.",
        },
        recurrence: {
          type: "string",
          enum: ["", "daily", "weekdays", "weekly", "biweekly", "monthly"],
          description: "Recurrence pattern for repeating tasks.",
        },
      },
    },
  },
  {
    name: "axis_update_task",
    description: "Update an existing task by ID. Only include fields you want to change.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", description: "Task ID to update." },
        task_name: { type: "string", description: "New task name." },
        task_priority: {
          type: "string",
          enum: [
            "Urgent & Important",
            "Important, Not Urgent",
            "Urgent, Not Important",
            "Not Urgent & Not Important",
          ],
        },
        task_category: {
          type: "string",
          enum: ["study", "project", "chores", "personal", "social"],
        },
        task_deadline: { type: "string", description: "YYYY-MM-DD format." },
        task_deadline_time: { type: "string", description: "HH:MM format." },
        task_duration_hours: { type: "number" },
        computer_required: { type: "boolean" },
        completed: { type: "boolean", description: "Mark task as completed/incomplete." },
      },
    },
  },
  {
    name: "axis_delete_task",
    description: "Delete a task by ID.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", description: "Task ID to delete." },
      },
    },
  },
  {
    name: "axis_complete_task",
    description: "Mark a task as completed. Shorthand for updating with completed=true.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", description: "Task ID to complete." },
      },
    },
  },

  // ---------- Goals ----------
  {
    name: "axis_list_goals",
    description: "List all goals from Axis. Goals are organized by timeframe (lifetime, yearly, monthly, weekly, daily).",
    inputSchema: {
      type: "object",
      properties: {
        level: {
          type: "string",
          enum: ["lifetime", "yearly", "monthly", "weekly", "daily"],
          description: "Filter by goal timeframe level.",
        },
      },
    },
  },
  {
    name: "axis_create_goal",
    description: "Create a new goal in Axis.",
    inputSchema: {
      type: "object",
      required: ["name", "level"],
      properties: {
        name: { type: "string", description: "Goal description." },
        level: {
          type: "string",
          enum: ["lifetime", "yearly", "monthly", "weekly", "daily"],
          description: "Goal timeframe level.",
        },
        parent_id: {
          type: "string",
          description: "Parent goal ID for hierarchical organization.",
        },
        start_date: { type: "string", description: "Start date (YYYY-MM-DD)." },
        end_date: { type: "string", description: "Target end date (YYYY-MM-DD)." },
      },
    },
  },
  {
    name: "axis_update_goal",
    description: "Update an existing goal by ID.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", description: "Goal ID to update." },
        name: { type: "string", description: "New goal description." },
        progress: {
          type: "number",
          description: "Progress percentage (0-100).",
        },
        start_date: { type: "string" },
        end_date: { type: "string" },
      },
    },
  },
  {
    name: "axis_delete_goal",
    description: "Delete a goal by ID.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", description: "Goal ID to delete." },
      },
    },
  },

  // ---------- Habits ----------
  {
    name: "axis_list_habits",
    description: "List all daily habits from Axis.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "axis_add_habit",
    description: "Add a new daily habit to Axis.",
    inputSchema: {
      type: "object",
      required: ["name", "time"],
      properties: {
        name: { type: "string", description: "Habit name." },
        time: { type: "string", description: "Time of day (HH:MM format)." },
        description: { type: "string", description: "Optional description." },
      },
    },
  },
  {
    name: "axis_delete_habit",
    description: "Delete a daily habit by ID.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", description: "Habit ID to delete." },
      },
    },
  },

  // ---------- Schedule ----------
  {
    name: "axis_get_schedule",
    description: "Get the AI-generated schedule for a specific date or date range.",
    inputSchema: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "Date in YYYY-MM-DD format. Defaults to today.",
        },
        days: {
          type: "number",
          description: "Number of days to retrieve (1-7). Default is 1.",
        },
      },
    },
  },
  {
    name: "axis_regenerate_schedule",
    description: "Trigger AI to regenerate the schedule based on current tasks and preferences.",
    inputSchema: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "Start date for regeneration (YYYY-MM-DD). Defaults to today.",
        },
      },
    },
  },

  // ---------- Calendar ----------
  {
    name: "axis_get_calendar_links",
    description: "Get calendar subscription links (webcal/iCal URLs) for integrating Axis with external calendars.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },

  // ---------- Reflections ----------
  {
    name: "axis_list_reflections",
    description: "List past reflections with optional date filtering.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of reflections to return (default 10).",
        },
      },
    },
  },
  {
    name: "axis_create_reflection",
    description: "Create a new reflection entry.",
    inputSchema: {
      type: "object",
      required: ["text"],
      properties: {
        text: {
          type: "string",
          description: "Reflection content/text.",
        },
        date: {
          type: "string",
          description: "Date for the reflection (YYYY-MM-DD). Defaults to today.",
        },
      },
    },
  },

  // ---------- Analytics ----------
  {
    name: "axis_get_analytics",
    description: "Get productivity analytics and statistics.",
    inputSchema: {
      type: "object",
      properties: {
        period: {
          type: "string",
          enum: ["day", "week", "month"],
          description: "Analytics period (default: week).",
        },
      },
    },
  },

  // ---------- User Profile ----------
  {
    name: "axis_get_profile",
    description: "Get the current user's profile and preferences.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "axis_update_preferences",
    description: "Update user preferences (work style, productive time, etc.).",
    inputSchema: {
      type: "object",
      properties: {
        preferred_work_style: {
          type: "string",
          enum: ["Short, focused bursts", "Long, deep sessions", "A mix of both"],
        },
        most_productive_time: {
          type: "string",
          enum: ["Early Morning", "Morning", "Afternoon", "Evening", "Late Night"],
        },
        weekly_personal_time: { type: "number" },
        weekly_review_hours: { type: "number" },
      },
    },
  },
];

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * Handle tool calls from the MCP client
 * @param {string} name - Tool name
 * @param {object} args - Tool arguments
 * @returns {Promise<any>} - Tool result
 */
async function handleToolCall(name, args) {
  // Verify authentication
  if (!AXIS_API_TOKEN) {
    throw new Error(
      "AXIS_API_TOKEN is not set. Please configure it with a valid JWT from Axis /api/auth/login."
    );
  }

  // ---------- Tasks ----------
  if (name === "axis_list_tasks") {
    const params = new URLSearchParams();
    if (args?.completed !== undefined) params.set("completed", String(args.completed));
    if (args?.category) params.set("category", args.category);
    const query = params.toString();
    return axisFetchJson(`/api/tasks${query ? `?${query}` : ""}`, { method: "GET" });
  }

  if (name === "axis_create_task") {
    validateRequired(args, ["task_name"]);
    validateDate(args?.task_deadline, "task_deadline");
    validatePositiveNumber(args?.task_duration_hours, "task_duration_hours");
    return axisFetchJson("/api/tasks", { method: "POST", body: JSON.stringify(args || {}) });
  }

  if (name === "axis_update_task") {
    validateRequired(args, ["id"]);
    const id = String(args.id).trim();
    const { id: _id, ...patch } = args || {};
    validateDate(patch?.task_deadline, "task_deadline");
    validatePositiveNumber(patch?.task_duration_hours, "task_duration_hours");
    return axisFetchJson(`/api/tasks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  }

  if (name === "axis_delete_task") {
    validateRequired(args, ["id"]);
    const id = String(args.id).trim();
    return axisFetchJson(`/api/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  if (name === "axis_complete_task") {
    validateRequired(args, ["id"]);
    const id = String(args.id).trim();
    return axisFetchJson(`/api/tasks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ completed: true }),
    });
  }

  // ---------- Goals ----------
  if (name === "axis_list_goals") {
    const params = new URLSearchParams();
    if (args?.level) params.set("level", args.level);
    const query = params.toString();
    return axisFetchJson(`/api/goals${query ? `?${query}` : ""}`, { method: "GET" });
  }

  if (name === "axis_create_goal") {
    validateRequired(args, ["name", "level"]);
    validateDate(args?.start_date, "start_date");
    validateDate(args?.end_date, "end_date");
    return axisFetchJson("/api/goals", { method: "POST", body: JSON.stringify(args || {}) });
  }

  if (name === "axis_update_goal") {
    validateRequired(args, ["id"]);
    const id = String(args.id).trim();
    const { id: _id, ...patch } = args || {};
    if (patch.progress !== undefined) {
      const progress = Number(patch.progress);
      if (isNaN(progress) || progress < 0 || progress > 100) {
        throw new Error("Progress must be a number between 0 and 100");
      }
    }
    validateDate(patch?.start_date, "start_date");
    validateDate(patch?.end_date, "end_date");
    return axisFetchJson(`/api/goals/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  }

  if (name === "axis_delete_goal") {
    validateRequired(args, ["id"]);
    const id = String(args.id).trim();
    return axisFetchJson(`/api/goals/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  // ---------- Habits ----------
  if (name === "axis_list_habits") {
    return axisFetchJson("/api/habits", { method: "GET" });
  }

  if (name === "axis_add_habit") {
    validateRequired(args, ["name", "time"]);
    return axisFetchJson("/api/habits", { method: "POST", body: JSON.stringify(args || {}) });
  }

  if (name === "axis_delete_habit") {
    validateRequired(args, ["id"]);
    const id = String(args.id).trim();
    return axisFetchJson(`/api/habits/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  // ---------- Schedule ----------
  if (name === "axis_get_schedule") {
    const params = new URLSearchParams();
    if (args?.date) {
      validateDate(args.date, "date");
      params.set("date", args.date);
    }
    if (args?.days) {
      const days = Math.min(7, Math.max(1, Number(args.days) || 1));
      params.set("days", String(days));
    }
    const query = params.toString();
    return axisFetchJson(`/api/schedule${query ? `?${query}` : ""}`, { method: "GET" });
  }

  if (name === "axis_regenerate_schedule") {
    const body = {};
    if (args?.date) {
      validateDate(args.date, "date");
      body.date = args.date;
    }
    return axisFetchJson("/api/schedule/regenerate", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  // ---------- Calendar ----------
  if (name === "axis_get_calendar_links") {
    return axisFetchJson("/api/calendar/token", { method: "GET" });
  }

  // ---------- Reflections ----------
  if (name === "axis_list_reflections") {
    const params = new URLSearchParams();
    if (args?.limit) {
      const limit = Math.min(100, Math.max(1, Number(args.limit) || 10));
      params.set("limit", String(limit));
    }
    const query = params.toString();
    return axisFetchJson(`/api/reflections${query ? `?${query}` : ""}`, { method: "GET" });
  }

  if (name === "axis_create_reflection") {
    validateRequired(args, ["text"]);
    if (args?.date) validateDate(args.date, "date");
    return axisFetchJson("/api/reflections", { method: "POST", body: JSON.stringify(args || {}) });
  }

  // ---------- Analytics ----------
  if (name === "axis_get_analytics") {
    const params = new URLSearchParams();
    if (args?.period) params.set("period", args.period);
    const query = params.toString();
    return axisFetchJson(`/api/analytics${query ? `?${query}` : ""}`, { method: "GET" });
  }

  // ---------- User Profile ----------
  if (name === "axis_get_profile") {
    return axisFetchJson("/api/user/profile", { method: "GET" });
  }

  if (name === "axis_update_preferences") {
    return axisFetchJson("/api/user/preferences", {
      method: "PATCH",
      body: JSON.stringify(args || {}),
    });
  }

  throw new Error(`Unknown tool: ${name}`);
}

// ============================================================================
// Resource Definitions (Read-only data access)
// ============================================================================

const resources = [
  {
    uri: "axis://tasks",
    name: "All Tasks",
    description: "Read-only access to all tasks in Axis",
    mimeType: "application/json",
  },
  {
    uri: "axis://goals",
    name: "All Goals",
    description: "Read-only access to all goals organized by timeframe",
    mimeType: "application/json",
  },
  {
    uri: "axis://habits",
    name: "Daily Habits",
    description: "Read-only access to daily habits",
    mimeType: "application/json",
  },
  {
    uri: "axis://schedule/today",
    name: "Today's Schedule",
    description: "Read-only access to today's schedule",
    mimeType: "application/json",
  },
  {
    uri: "axis://profile",
    name: "User Profile",
    description: "Read-only access to user profile and preferences",
    mimeType: "application/json",
  },
];

/**
 * Handle resource read requests
 * @param {string} uri - Resource URI
 * @returns {Promise<{contents: Array}>} - Resource contents
 */
async function handleResourceRead(uri) {
  if (!AXIS_API_TOKEN) {
    throw new Error("AXIS_API_TOKEN is not set");
  }

  let data;
  let mimeType = "application/json";

  switch (uri) {
    case "axis://tasks":
      data = await axisFetchJson("/api/tasks", { method: "GET" });
      break;
    case "axis://goals":
      data = await axisFetchJson("/api/goals", { method: "GET" });
      break;
    case "axis://habits":
      data = await axisFetchJson("/api/habits", { method: "GET" });
      break;
    case "axis://schedule/today":
      data = await axisFetchJson("/api/schedule", { method: "GET" });
      break;
    case "axis://profile":
      data = await axisFetchJson("/api/user/profile", { method: "GET" });
      break;
    default:
      throw new Error(`Unknown resource: ${uri}`);
  }

  return {
    contents: [
      {
        uri,
        mimeType,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

// ============================================================================
// Server Setup
// ============================================================================

const server = new Server(
  { name: SERVER_NAME, version: SERVER_VERSION },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// Register tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params?.name;
  const args = request.params?.arguments || {};

  try {
    const result = await handleToolCall(name, args);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (err) {
    const errorMessage = err?.message || String(err);
    const statusCode = err?.statusCode;
    
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: statusCode
            ? `Error (${statusCode}): ${errorMessage}`
            : `Error: ${errorMessage}`,
        },
      ],
    };
  }
});

// Register resource handlers
server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources }));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params?.uri;
  
  try {
    return await handleResourceRead(uri);
  } catch (err) {
    throw new Error(`Failed to read resource ${uri}: ${err?.message || err}`);
  }
});

// ============================================================================
// Start Server
// ============================================================================

const transport = new StdioServerTransport();
await server.connect(transport);

// Log startup (to stderr to not interfere with MCP protocol on stdout)
console.error(`[${SERVER_NAME}] Server started (v${SERVER_VERSION})`);
console.error(`[${SERVER_NAME}] API Base: ${AXIS_API_BASE_URL}`);
console.error(`[${SERVER_NAME}] Auth: ${AXIS_API_TOKEN ? "Configured" : "NOT CONFIGURED"}`);
