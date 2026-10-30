(() => {
  const listeners = new Set();
  const stores = {
    local: globalThis.localStorage,
    session: globalThis.sessionStorage,
  };

  function read(store, key) {
    const raw = store.getItem(key);
    if (raw === null) {
      return undefined;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  function readAll(store) {
    const values = {};
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (key !== null) {
        values[key] = read(store, key);
      }
    }
    return values;
  }

  function notify(areaName, changes) {
    for (const listener of listeners) {
      listener(changes, areaName);
    }
  }

  function makeArea(areaName) {
    const store = stores[areaName];

    return {
      async get(keys) {
        if (keys === null || keys === undefined) {
          return readAll(store);
        }
        if (typeof keys === "string") {
          const value = read(store, keys);
          return value === undefined ? {} : { [keys]: value };
        }
        if (Array.isArray(keys)) {
          const result = {};
          for (const key of keys) {
            const value = read(store, key);
            if (value !== undefined) {
              result[key] = value;
            }
          }
          return result;
        }
        const result = { ...keys };
        for (const key of Object.keys(keys)) {
          const value = read(store, key);
          if (value !== undefined) {
            result[key] = value;
          }
        }
        return result;
      },

      async set(items) {
        const changes = {};
        for (const [key, value] of Object.entries(items)) {
          const oldValue = read(store, key);
          store.setItem(key, JSON.stringify(value));
          changes[key] = { oldValue, newValue: value };
        }
        notify(areaName, changes);
      },

      async remove(keys) {
        const list = Array.isArray(keys) ? keys : [keys];
        const changes = {};
        for (const key of list) {
          const oldValue = read(store, key);
          store.removeItem(key);
          changes[key] = { oldValue, newValue: undefined };
        }
        notify(areaName, changes);
      },

      async clear() {
        const values = readAll(store);
        store.clear();
        const changes = {};
        for (const [key, oldValue] of Object.entries(values)) {
          changes[key] = { oldValue, newValue: undefined };
        }
        notify(areaName, changes);
      },
    };
  }

  const storage = {
    local: makeArea("local"),
    session: makeArea("session"),
    onChanged: {
      addListener(listener) {
        listeners.add(listener);
      },
      removeListener(listener) {
        listeners.delete(listener);
      },
    },
  };

  globalThis.chrome = {
    storage,
    runtime: {
      id: "test-extension",
      async sendMessage(message) {
        if (!message || message.target !== "background") {
          return undefined;
        }
        if (message.type === "tts:start") {
          await storage.session.set({
            "playback-state": {
              status: "playing",
              driver: "openai",
              receivedBytes: 2048,
              updatedAt: Date.now(),
            },
          });
        } else if (message.type === "tts:stop") {
          await storage.session.set({
            "playback-state": { status: "idle", updatedAt: Date.now() },
          });
        }
        return undefined;
      },
      onMessage: {
        addListener() {},
        removeListener() {},
      },
    },
    tabs: {
      async query() {
        return [{ id: 1 }];
      },
      async sendMessage() {
        return undefined;
      },
    },
  };
})();
