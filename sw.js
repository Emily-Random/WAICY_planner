/* global self */

const STATIC_CACHE = "axis-static-v1";
const RUNTIME_CACHE = "axis-runtime-v1";
const DB_NAME = "axis_pwa";
const DB_VERSION = 1;

const CORE_ASSETS = [
  "index.html",
  "dashboard.html",
  "style.css",
  "script.js",
  "dashboard.js",
  "manifest.json",
  "favicon.svg",
  "assets/axis-banner.svg",
  "assets/illustrations/empty-calendar.svg",
  "assets/illustrations/empty-goals.svg",
  "assets/illustrations/empty-habits.svg",
  "assets/illustrations/empty-reflections.svg",
  "assets/illustrations/empty-tasks.svg",
  "js/modules/toast.js",
  "js/utils/confetti.js",
  "js/modules/celebrations.js",
  "js/modules/keyboard-shortcuts.js",
  "js/modules/notifications.js",
  "js/modules/calendar-export.js",
  "js/modules/onboarding-tour.js"
];

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) {
        db.createObjectStore("kv", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("queue")) {
        db.createObjectStore("queue", { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetAll(storeName) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(storeName, key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function flushQueue() {
  const items = await idbGetAll("queue");
  if (!items.length) return;

  // Process in order; stop on first failure to retry later.
  const ordered = items.slice().sort((a, b) => (a.id || 0) - (b.id || 0));
  for (const item of ordered) {
    if (!item || !item.url || !item.method) {
      if (item?.id != null) await idbDelete("queue", item.id);
      continue;
    }

    const res = await fetch(item.url, {
      method: item.method,
      headers: item.headers || {},
      body: item.body,
    });

    if (!res.ok) {
      throw new Error(`Sync failed (${res.status})`);
    }

    await idbDelete("queue", item.id);
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      await cache.addAll(CORE_ASSETS);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((key) => {
          if (![STATIC_CACHE, RUNTIME_CACHE].includes(key)) {
            return caches.delete(key);
          }
          return null;
        }),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin.
  if (url.origin !== self.location.origin) return;

  // Navigation: network-first, fallback to cache.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          const cache = await caches.open(STATIC_CACHE);
          cache.put(req, res.clone());
          return res;
        } catch {
          const cached = await caches.match(req);
          if (cached) return cached;
          return caches.match("index.html");
        }
      })(),
    );
    return;
  }

  // Cache-first for static assets.
  if (req.method === "GET" && !url.pathname.startsWith("/api/")) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        const res = await fetch(req);
        const cache = await caches.open(STATIC_CACHE);
        cache.put(req, res.clone());
        return res;
      })(),
    );
    return;
  }

  // Network-first for API GETs with cache fallback.
  if (req.method === "GET" && url.pathname.startsWith("/api/")) {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          const cache = await caches.open(RUNTIME_CACHE);
          cache.put(req, res.clone());
          return res;
        } catch {
          return caches.match(req);
        }
      })(),
    );
  }
});

self.addEventListener("sync", (event) => {
  if (event.tag === "axis-sync") {
    event.waitUntil(flushQueue());
  }
});

