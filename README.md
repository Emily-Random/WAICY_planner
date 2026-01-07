<p align="center">
  <img src="assets/axis-banner.svg" alt="Axis" width="900" />
</p>

# Axis – AI Student Planner

Axis is a web-based student planning application that generates a personalized, time-blocked schedule based on a user’s tasks, deadlines, and daily routine. It is designed to help students manage their workload efficiently and reduce procrastination.

## Features

- Profile-based onboarding to collect schedule, habits, and preferences

- Long-term goal management

- Task creation with priority, category, deadline, and estimated duration

- Automatic task ranking by urgency and importance

- AI-assisted scheduling that fits tasks into available time blocks

- Daily, weekly, and monthly calendar views

- Built-in planning assistant for schedule and focus guidance

- Pomodoro focus timer and countdown mode for deadline-driven work

## Application Flow

1. Profile Setup
   Users enter basic information, fixed weekly and weekend activities, sleep schedules, breaks, and work preferences.

2. Task Input
   Users add tasks with priority level, category, deadlines, and estimated duration.

3. Plan Generation
   The system ranks tasks and generates a structured schedule that ensures tasks are completed before their deadlines.

4. Execution & Focus
   Users can follow the generated schedule, use the focus timer, and interact with the planning assistant.

## Tech Stack

- Frontend: HTML, CSS, Vanilla JavaScript
- Backend: Node.js + Express (auth, persistence, AI endpoints)

## How to Run

- Install dependencies:
  - `npm install`

- Configure environment variables:
  - Copy `.env.example` → `.env`
  - Set `JWT_SECRET` and your `DEEPSEEK_API_KEY`

- Start the server:
  - `npm run dev`

- Open:
  - `http://localhost:3000`

## MCP (Optional)

Axis includes an MCP server (`mcp-server.mjs`) that exposes tools for reading/updating a user's tasks and habits in `user_data/`.

- Copy `mcp.json.example` to your MCP client's config and set `AXIS_MCP_USER_ID`
- Or run directly: `AXIS_MCP_USER_ID=... npm run mcp`

## Future Improvements

- Persistent storage and optional accounts

- Improved rescheduling and conflict handling

- Enhanced mobile responsiveness

- More advanced planning logic
