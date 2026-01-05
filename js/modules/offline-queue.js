// Offline Action Queue System
// Queues API requests when offline and syncs when online

const QUEUE_STORAGE_KEY = 'axis_offline_queue';
const MAX_QUEUE_SIZE = 100;

class OfflineQueue {
  constructor() {
    this.queue = [];
    this.isOnline = navigator.onLine;
    this.syncing = false;
    this.listeners = new Set();
    this.loadQueue();
    this.setupListeners();
  }

  setupListeners() {
    // Listen for online/offline events
    window.addEventListener('online', () => {
      this.isOnline = true;
      this.notifyListeners({ type: 'online' });
      this.sync();
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
      this.notifyListeners({ type: 'offline' });
    });

    // Periodically try to sync if online
    setInterval(() => {
      if (this.isOnline && this.queue.length > 0 && !this.syncing) {
        this.sync();
      }
    }, 30000); // Try every 30 seconds
  }

  loadQueue() {
    try {
      const stored = localStorage.getItem(QUEUE_STORAGE_KEY);
      if (stored) {
        this.queue = JSON.parse(stored);
      }
    } catch (err) {
      console.error('Failed to load offline queue:', err);
      this.queue = [];
    }
  }

  saveQueue() {
    try {
      localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(this.queue));
    } catch (err) {
      console.error('Failed to save offline queue:', err);
      // If storage is full, remove oldest items
      if (err.name === 'QuotaExceededError') {
        this.queue = this.queue.slice(-50);
        try {
          localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(this.queue));
        } catch (e) {
          console.error('Failed to save truncated queue:', e);
        }
      }
    }
  }

  // Add a request to the queue
  enqueue(endpoint, options = {}) {
    if (this.queue.length >= MAX_QUEUE_SIZE) {
      // Remove oldest items
      this.queue = this.queue.slice(-MAX_QUEUE_SIZE + 1);
    }

    const queueItem = {
      id: `queue_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      endpoint,
      method: options.method || 'GET',
      body: options.body,
      headers: options.headers || {},
      timestamp: new Date().toISOString(),
      retries: 0,
    };

    this.queue.push(queueItem);
    this.saveQueue();
    this.notifyListeners({ type: 'enqueued', item: queueItem });

    return queueItem.id;
  }

  // Process the queue
  async sync() {
    if (this.syncing || !this.isOnline || this.queue.length === 0) {
      return;
    }

    this.syncing = true;
    this.notifyListeners({ type: 'sync-start' });

    const itemsToProcess = [...this.queue];
    const successful = [];
    const failed = [];

    for (const item of itemsToProcess) {
      try {
        const response = await fetch(item.endpoint, {
          method: item.method,
          headers: item.headers,
          body: item.body,
        });

        if (response.ok) {
          successful.push(item.id);
          // Remove from queue
          this.queue = this.queue.filter(q => q.id !== item.id);
        } else {
          // Retry logic - give up after 3 retries
          item.retries += 1;
          if (item.retries >= 3) {
            failed.push(item);
            this.queue = this.queue.filter(q => q.id !== item.id);
          }
        }
      } catch (err) {
        item.retries += 1;
        if (item.retries >= 3) {
          failed.push(item);
          this.queue = this.queue.filter(q => q.id !== item.id);
        }
      }
    }

    this.saveQueue();
    this.syncing = false;

    this.notifyListeners({
      type: 'sync-complete',
      successful: successful.length,
      failed: failed.length,
    });

    return { successful: successful.length, failed: failed.length };
  }

  // Get queue status
  getStatus() {
    return {
      isOnline: this.isOnline,
      queueLength: this.queue.length,
      syncing: this.syncing,
      queue: this.queue, // Expose queue for checking items
    };
  }
  
  // Check if an item exists in queue
  hasItem(id) {
    return this.queue.some(item => item.id === id);
  }

  // Clear the queue
  clear() {
    this.queue = [];
    this.saveQueue();
    this.notifyListeners({ type: 'cleared' });
  }

  // Subscribe to queue events
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notifyListeners(event) {
    this.listeners.forEach(listener => {
      try {
        listener(event);
      } catch (err) {
        console.error('Error in offline queue listener:', err);
      }
    });
  }

  // Remove a specific item from queue
  remove(id) {
    this.queue = this.queue.filter(q => q.id !== id);
    this.saveQueue();
  }
}

export const offlineQueue = new OfflineQueue();

