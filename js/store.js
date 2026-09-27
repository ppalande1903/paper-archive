/* Where papers live.
   Kept papers go in IndexedDB (stay until deleted). Papers the user chose not to keep go in
   sessionStorage (gone when the tab closes). Nothing here ever leaves the browser. */
window.PA = window.PA || {};

PA.store = (function () {
  const SESSION = "pa-session-papers";
  const memory = {}; // last resort if sessionStorage is unavailable (lasts for this page view only)
  let dbp;

  function db() {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        if (!window.indexedDB) return reject(new Error("IndexedDB unavailable"));
        const req = indexedDB.open("paper-archive", 1);
        req.onupgradeneeded = () => req.result.createObjectStore("papers", { keyPath: "id" });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbp;
  }

  async function idb(mode, op) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const req = op(d.transaction("papers", mode).objectStore("papers"));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function readSession() {
    try { return JSON.parse(sessionStorage.getItem(SESSION)) || {}; } catch (e) { return {}; }
  }
  function writeSession(map) {
    try { sessionStorage.setItem(SESSION, JSON.stringify(map)); return true; } catch (e) { return false; }
  }
  const plain = (p) => { const c = { ...p }; delete c.kept; return c; };

  return {
    async all() {
      let saved = [];
      try { saved = await idb("readonly", (s) => s.getAll()); } catch (e) {}
      const out = {};
      saved.forEach((p) => (out[p.id] = { ...p, kept: true }));
      [...Object.values(readSession()), ...Object.values(memory)].forEach((p) => { if (!out[p.id]) out[p.id] = { ...p, kept: false }; });
      return Object.values(out).sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
    },

    async get(id) {
      return (await this.all()).find((p) => p.id === id) || null;
    },

    /* Save on this device. Throws if the browser refuses (e.g. private mode). */
    async keep(paper) {
      await idb("readwrite", (s) => s.put(plain(paper)));
      const m = readSession(); delete m[paper.id]; writeSession(m);
      delete memory[paper.id];
    },

    /* Hold only until this tab closes. */
    async holdForSession(paper) {
      const m = readSession();
      m[paper.id] = plain(paper);
      if (!writeSession(m)) memory[paper.id] = plain(paper);
      try { await idb("readwrite", (s) => s.delete(paper.id)); } catch (e) {}
    },

    async remove(id) {
      try { await idb("readwrite", (s) => s.delete(id)); } catch (e) {}
      const m = readSession(); delete m[id]; writeSession(m);
      delete memory[id];
    },

    async clearSaved() {
      try { await idb("readwrite", (s) => s.clear()); } catch (e) {}
    }
  };
})();
