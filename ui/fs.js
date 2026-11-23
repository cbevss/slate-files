// One async filesystem API for the UI. Inside the Slate app it calls the Rust
// engine. Opened in a plain browser, it runs on the synthetic sample tree from
// data.js, with transfers simulated (and labelled as simulated).
(function () {
  "use strict";
  const T = window.__TAURI__;

  if (T && T.core) {
    const invoke = T.core.invoke;
    const listeners = new Map();
    T.event.listen("transfer", (ev) => { const cb = listeners.get(ev.payload.id); if (cb) cb(ev.payload); });
    let platform = "windows", drives = [], places = [];
    window.FSX = {
      real: true,
      get platform() { return platform; },
      get sep() { return platform === "windows" ? "\\" : "/"; },
      async init() {
        platform = await invoke("platform");
        [drives, places] = await Promise.all([invoke("drives"), invoke("places")]);
      },
      drives: () => drives,
      async refreshDrives() { drives = await invoke("drives"); return drives; },
      places: () => places,
      home: () => (places.find((p) => p.label === "Home") || {}).path || (drives[0] || {}).id || "",
      async list(path) {
        if (path === "") return drives.map((d) => ({ name: d.label, dir: true, drive: d, path: d.id, size: 0, mtime: null }));
        return invoke("list_dir", { path });
      },
      freeSpace: (path) => invoke("free_space", { path }),
      rename: (path, name) => invoke("rename", { path, name }),
      mkdir: (parent, name) => invoke("mkdir", { parent, name }),
      trash: (paths) => invoke("trash", { paths }),
      restore: (paths) => invoke("restore", { paths }),
      deletePermanent: (paths) => invoke("delete_permanent", { paths }),
      open: (path) => invoke("open_path", { path }),
      dirSize: (path) => invoke("dir_size", { path }),
      sha256: (path) => invoke("sha256", { path }),
      duplicates: (path) => invoke("duplicates", { path }),
      search: (query) => invoke("search", { query, limit: 60 }),
      indexStatus: () => invoke("index_status"),
      reindex: () => invoke("reindex"),
      simulated: false,
      startupPath: () => invoke("startup_path"),
      defaultStatus: () => invoke("default_status"),
      setDefault: (enable) => invoke("set_default", { enable }),
      onOpenPath: (cb) => T.event.listen("open-path", (ev) => cb(ev.payload)),
      autoUpdate: () => invoke("auto_update_enabled"),
      setAutoUpdate: (on) => invoke("set_auto_update", { on }),
      checkUpdates: (quiet) => invoke("check_updates", { quiet }),
      onUpdate: (cb) => T.event.listen("update-status", (ev) => cb(ev.payload)),
      async transfer(mode, sources, dest, onProgress) {
        let resolve;
        const done = new Promise((r) => (resolve = r));
        const id = await invoke("start_transfer", { mode, sources, dest });
        listeners.set(id, (p) => {
          onProgress(p);
          if (p.state !== "running" && p.state !== "paused") { listeners.delete(id); resolve(p); }
        });
        return { id, done, pause: (b) => invoke("pause_transfer", { id, paused: b }), cancel: () => invoke("cancel_transfer", { id }) };
      },
      window: T.window && T.window.getCurrentWindow ? T.window.getCurrentWindow() : null,
    };
    return;
  }

  // ---------- browser preview: sample data ----------
  const F = window.FS;
  const wait = (v, ms = 0) => new Promise((r) => setTimeout(() => r(v), ms));
  const trashBin = [];
  window.FSX = {
    real: false,
    platform: "windows",
    sep: "\\",
    simulated: true,
    async init() {},
    drives: () => F.drives(),
    async refreshDrives() { return F.drives(); },
    places: () => [["Home", F.home, "home"], ["Desktop", F.home + "\\Desktop", "desktop"], ["Documents", F.home + "\\Documents", "doc"], ["Downloads", F.home + "\\Downloads", "download"], ["Pictures", F.home + "\\Pictures", "image"], ["Music", F.home + "\\Music", "audio"]].map(([label, path, icon]) => ({ label, path, icon })),
    home: () => F.home,
    async list(path) {
      const l = F.list(path);
      if (!l) throw new Error(`${path} no longer exists.`);
      return wait(l.map((e) => ({ ...e, hidden: false })));
    },
    async freeSpace(path) { return F.free(path.split("\\")[0]); },
    async rename(path, name) {
      if (/[\\/:*?"<>|]/.test(name)) throw new Error('Names can\'t contain \\ / : * ? " < > |');
      if (!F.rename(path, name)) throw new Error(`There's already an item called ${name} here.`);
      return path.slice(0, path.lastIndexOf("\\") + 1) + name;
    },
    async mkdir(parent, name) {
      const names = new Set((F.list(parent) || []).map((e) => e.name));
      let n = name, i = 2; while (names.has(n)) n = `${name} (${i++})`;
      F.mkdir(parent, n); return parent + "\\" + n;
    },
    async trash(paths) { paths.forEach((p) => { const e = F.remove(p); if (e) trashBin.push({ p, e }); }); },
    async restore(paths) {
      let n = 0;
      paths.forEach((p) => { const i = trashBin.findIndex((t) => t.p === p); if (i >= 0) { const t = trashBin.splice(i, 1)[0]; F.insert(p.slice(0, p.lastIndexOf("\\")), t.e); n++; } });
      return n;
    },
    async deletePermanent(paths) { paths.forEach((p) => F.remove(p)); },
    async open() {},
    async dirSize(path) { return wait({ bytes: F.size(path), files: 0, dirs: 0 }, 120); },
    async sha256(path) {
      let h = 2166136261; for (const c of path) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
      let hex = ""; for (let n = 0; n < 8; n++) { h = Math.imul(h ^ (h >>> 15), 2246822507); hex += (h >>> 0).toString(16).padStart(8, "0"); }
      return wait(hex, 500);
    },
    async duplicates() { return []; },
    async search(query) {
      const t0 = performance.now();
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      const hits = [];
      F.walk((n, path, parent) => {
        const l = n.name.toLowerCase();
        if (terms.length && terms.every((t) => l.includes(t))) hits.push({ name: n.name, path, parent, dir: n.dir, r: l.indexOf(terms[0]) === 0 ? 0 : 1 });
      });
      hits.sort((a, b) => a.r - b.r || b.dir - a.dir || a.name.length - b.name.length);
      let count = 0; F.walk(() => count++);
      return { hits: hits.slice(0, 60), total: hits.length, ms: performance.now() - t0, indexed: count, building: false };
    },
    async indexStatus() { let count = 0; F.walk(() => count++); return { building: false, count, build_ms: 1 }; },
    async reindex() {},
    async startupPath() { return null; },
    async defaultStatus() { return false; },
    async setDefault() { throw new Error("Install the Slate app to make it your default file explorer."); },
    onOpenPath() {},
    async autoUpdate() { return false; },
    async setAutoUpdate() {},
    async checkUpdates() {},
    onUpdate() {},
    async transfer(mode, sources, dest, onProgress) {
      const items = sources.map((p) => ({ p, e: (F.list(p.slice(0, p.lastIndexOf("\\"))) || []).find((x) => x.path === p) })).filter((x) => x.e);
      const total = items.reduce((a, x) => a + (x.e.dir ? F.size(x.p) : x.e.size), 0);
      const same = mode === "move" && items.every((x) => x.p.split("\\")[0] === dest.split("\\")[0]);
      let paused = false, cancelled = false, doneBytes = 0;
      const speed = (380 + Math.random() * 260) * 1048576;
      const finish = () => {
        const out = [];
        const names = new Set((F.list(dest) || []).map((e) => e.name));
        items.forEach(({ p, e }) => {
          if (mode === "move" && p.slice(0, p.lastIndexOf("\\")) === dest) return;
          let name = e.name, n = 2;
          while (names.has(name)) { const d = e.name.lastIndexOf("."); name = d > 0 && !e.dir ? `${e.name.slice(0, d)} (${n})${e.name.slice(d)}` : `${e.name} (${n})`; n++; }
          names.add(name);
          const src = mode === "move" ? F.remove(p) : F.clone(e);
          const entry = F.clone(src); delete entry.path; delete entry.items; entry.name = name;
          F.insert(dest, entry);
          out.push({ from: p, to: dest + "\\" + name });
        });
        if (!same) F.useSpace(dest.split("\\")[0], total);
        return out;
      };
      let resolve; const done = new Promise((r) => (resolve = r));
      const base = { id: 1, total, files_total: items.length, items: [], errors: [] };
      if (same || total < 64 * 1048576) { setTimeout(() => { const it = finish(); resolve({ ...base, state: "done", done: total, files_done: items.length, bytes_per_sec: 0, items: it }); }, 0); }
      else {
        let last = performance.now();
        const tick = (now) => {
          if (cancelled) return resolve({ ...base, state: "cancelled", done: doneBytes, files_done: 0, bytes_per_sec: 0 });
          const dt = (now - last) / 1000; last = now;
          if (!paused) doneBytes = Math.min(total, doneBytes + speed * dt * (0.85 + Math.random() * 0.3));
          onProgress({ ...base, state: paused ? "paused" : "running", done: doneBytes, files_done: 0, bytes_per_sec: paused ? 0 : speed });
          if (doneBytes >= total) { const it = finish(); return resolve({ ...base, state: "done", done: total, files_done: items.length, bytes_per_sec: 0, items: it }); }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }
      return { id: 1, done, pause: (b) => { paused = b; }, cancel: () => { cancelled = true; } };
    },
    window: null,
  };
})();
