// State Management
import { Api } from "./api.js";
import { toast } from "../components/toast.js";

const DEFAULT_STATE = {
  profile: null,
  tasks: [],
  rankedTasks: [],
  schedule: [],
  fixedBlocks: [],
  goals: [],
  reflections: [],
  blockingRules: [],
  dailyHabits: [],
  firstReflectionDueDate: null,
};

class Store {
  constructor() {
    this.state = JSON.parse(JSON.stringify(DEFAULT_STATE));
    this.listeners = new Set();
    this.autoSaveTimer = null;
  }

  async init() {
    try {
      const data = await Api.loadUserData();
      if (data) {
        this.state = { ...DEFAULT_STATE, ...data };
        this.normalizeData();
        this.notify();
      }
    } catch (err) {
      console.error("Failed to init store", err);
    }
  }

  getState() {
    return this.state;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    this.listeners.forEach(listener => listener(this.state));
  }

  setState(updater, immediateSave = false) {
    const oldState = { ...this.state };
    
    if (typeof updater === 'function') {
      this.state = { ...this.state, ...updater(this.state) };
    } else {
      this.state = { ...this.state, ...updater };
    }

    this.notify();

    // Auto-save logic
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    
    if (immediateSave) {
      this.save();
    } else {
      this.autoSaveTimer = setTimeout(() => this.save(), 2000);
    }
  }

  async save() {
    try {
      await Api.saveUserData(this.state);
      // console.log("State saved");
    } catch (err) {
      console.error("Save failed", err);
      toast.error("Failed to save changes");
    }
  }

  // --- Normalizers ---
  
  normalizeData() {
    this.normalizeTasks();
    this.migrateProfile();
  }

  normalizeTasks() {
    if (!Array.isArray(this.state.tasks)) {
      this.state.tasks = [];
      return;
    }
    
    this.state.tasks = this.state.tasks.map(t => this._normalizeSingleTask(t));
  }

  _normalizeSingleTask(raw) {
    // Logic from script.js normalizeTask
    const task_name = raw.task_name ?? raw.name ?? raw.title ?? "";
    const task_priority = this._normalizePriority(raw.task_priority ?? raw.priority);
    const task_category = (raw.task_category ?? raw.category ?? "study").trim().toLowerCase();
    const task_deadline = raw.task_deadline ?? raw.deadline ?? "";
    const task_deadline_time = raw.task_deadline_time ?? raw.deadlineTime ?? "23:59";
    const task_duration_hours = Number(raw.task_duration_hours ?? raw.estimatedHours ?? raw.durationHours ?? 0) || 0;
    const id = raw.id || `task_${Date.now()}_${Math.random().toString(16).slice(2)}`;

    return {
      id,
      task_name,
      task_priority,
      task_category,
      task_deadline,
      task_deadline_time,
      task_duration_hours,
      computer_required: Boolean(raw.computer_required ?? raw.computerRequired),
      completed: Boolean(raw.completed),
      fromDailyGoal: Boolean(raw.fromDailyGoal),
      goalId: raw.goalId || null
    };
  }

  _normalizePriority(val) {
    if (!val) return "";
    const v = String(val).trim();
    const map = {
      "urgent-important": "Urgent & Important",
      "urgent-not-important": "Urgent, Not Important",
      "important-not-urgent": "Important, Not Urgent",
      "not-urgent-not-important": "Not Urgent & Not Important",
    };
    if (Object.values(map).includes(v)) return v;
    const key = v.toLowerCase().replace(/[^a-z]+/g, "-");
    return map[key] || v; // Fallback
  }

  migrateProfile() {
    if (!this.state.profile) return;
    const p = this.state.profile;
    // Lowercase procrastinator types
    if (p.procrastinator_type) {
      p.procrastinator_type = p.procrastinator_type.toLowerCase();
    }
  }
}

export const store = new Store();
