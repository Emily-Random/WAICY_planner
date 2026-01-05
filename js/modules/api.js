// API Client
import { toast } from "../components/toast.js";
import { offlineQueue } from "./offline-queue.js";

const STORAGE_KEY = "planwise_auth_token";
const STORAGE_USER_KEY = "planwise_user";

export class Api {
  static getToken() {
    return localStorage.getItem(STORAGE_KEY);
  }

  static getUser() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_USER_KEY));
    } catch {
      return null;
    }
  }

  static setAuth(token, user) {
    if (token) {
      localStorage.setItem(STORAGE_KEY, token);
      if (user) localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(STORAGE_USER_KEY);
    }
  }

  static getHeaders() {
    const token = this.getToken();
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  static async request(endpoint, options = {}) {
    // Guest mode check
    const token = this.getToken();
    if (token && token.startsWith("guest_")) {
      // For guest mode, we don't hit the server for data operations
      // We only hit the server for AI operations if we allowed it (but we probably shouldn't without an API key)
      // For now, let's allow AI endpoints but block user data endpoints
      if (endpoint.includes("/user/data")) {
        console.warn("Blocked guest mode request to", endpoint);
        return null; 
      }
    }

    // Check if offline and this is a POST/PUT/DELETE request
    const isOffline = !navigator.onLine;
    const isModifyingRequest = options.method && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(options.method);

    if (isOffline && isModifyingRequest && !options.skipQueue) {
      // Queue the request for later
      const queueId = offlineQueue.enqueue(endpoint, {
        method: options.method,
        body: options.body,
        headers: this.getHeaders(),
      });
      
      if (!options.silent) {
        toast.info("You're offline. This action will be synced when you're back online.");
      }
      
      // Return immediately with queued status
      // The app should handle this gracefully (e.g., reload data after sync)
      return Promise.resolve({ queued: true, queueId });
    }

    try {
      const res = await fetch(endpoint, {
        headers: this.getHeaders(),
        ...options,
      });

      if (res.status === 401 || res.status === 403) {
        // Token expired or invalid
        if (!endpoint.includes("/login") && !endpoint.includes("/register")) {
          this.setAuth(null, null);
          window.location.href = "index.html#auth";
          return null;
        }
      }

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Request failed: ${res.status}`);
      }

      return await res.json();
    } catch (err) {
      // If network error and we're offline, queue it
      if (isOffline && isModifyingRequest && !options.skipQueue) {
        const queueId = offlineQueue.enqueue(endpoint, {
          method: options.method,
          body: options.body,
          headers: this.getHeaders(),
        });
        
        if (!options.silent) {
          toast.info("You're offline. This action will be synced when you're back online.");
        }
        
        return { queued: true, queueId };
      }

      console.error(`API Error (${endpoint}):`, err);
      if (!options.silent) {
        toast.error(err.message || "Network error occurred");
      }
      throw err;
    }
  }

  // Auth
  static async login(email, password) {
    const data = await this.request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    this.setAuth(data.token, data.user);
    return data;
  }

  static async register(name, email, password) {
    const data = await this.request("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ name, email, password }),
    });
    this.setAuth(data.token, data.user);
    return data;
  }

  static logout() {
    this.setAuth(null, null);
    window.location.href = "index.html";
  }

  // Data
  static async loadUserData() {
    // Check guest mode
    const token = this.getToken();
    if (token && token.startsWith("guest_")) {
      const localData = localStorage.getItem("planwise_guest_state");
      return localData ? JSON.parse(localData) : null;
    }
    
    return this.request("/api/user/data");
  }

  static async saveUserData(data) {
    // Check guest mode
    const token = this.getToken();
    if (token && token.startsWith("guest_")) {
      localStorage.setItem("planwise_guest_state", JSON.stringify(data));
      return { success: true };
    }

    return this.request("/api/user/data", {
      method: "POST",
      body: JSON.stringify(data),
      silent: true // Don't toast on every auto-save
    });
  }

  // AI
  static async chat(message, context) {
    return this.request("/api/chat", {
      method: "POST",
      body: JSON.stringify({ message, context }),
    });
  }

  static async getTaskPriority(taskData) {
    return this.request("/api/ai/task-priority", {
      method: "POST",
      body: JSON.stringify(taskData),
    });
  }
}
