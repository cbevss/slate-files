(async function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const icon = (name, cls = "i") => `<svg class="${cls}"><use href="#i-${name}"/></svg>`;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem("slate." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("slate." + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };
  const err = (e) => (e && e.message) || String(e);

  await FSX.init();
  document.documentElement.dataset.platform = FSX.platform;

  /* ---------- preferences (UI side; Rust keeps its own for updates, defaults, dialogs) ---------- */
  const PREFS = { view: "details", startIn: "last", exts: true, foldersFirst: true, singleClick: false, icons: "system", density: "comfortable", confirmTrash: false, motion: "full", dates: "relative" };
  const pref = (k) => store.get("pref." + k, PREFS[k]);
  function applyPrefs() {
    const d = document.documentElement.dataset;
    d.density = pref("density");
    d.motion = pref("motion");
  }
  applyPrefs();

  /* ---------- picker mode: this window is another app's Open / Save dialog ---------- */
  const PICK = FSX.pickerId;
  let REQ = null, pickType = 1;
  if (PICK) {
    REQ = await FSX.pickerRequest(PICK).catch(() => null);
    if (!REQ) { await FSX.pickerDone(PICK, [], null).catch(() => {}); return; }
    REQ.filters = REQ.filters || [];
    pickType = Math.min(Math.max(1, REQ.type_index || 1), Math.max(1, REQ.filters.length));
    document.documentElement.classList.add("picking");
  }
  const globRe = (g) => new RegExp("^" + g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$", "i");
  function pickPatterns() {
    const f = REQ && REQ.filters[pickType - 1];
    if (!f) return null;
    const pats = f.spec.split(";").map((s) => s.trim()).filter(Boolean);
    return pats.some((p) => p === "*" || p === "*.*") ? null : pats.map(globRe);
  }
  // in a picker, show folders and the files the chosen type allows
  function pickVisible(e) {
    if (!PICK || e.dir || e.drive) return true;
    if (REQ.mode === "folder") return false;
    const pats = pickPatterns();
    return !pats || pats.some((r) => r.test(e.name));
  }

  /* ---------- formatting ---------- */
  const UNITS = ["B", "KB", "MB", "GB", "TB"];
  function fmtSize(b) {
    if (b == null) return "";
    let i = 0; while (b >= 1024 && i < UNITS.length - 1) { b /= 1024; i++; }
    const d = i === 0 ? 0 : b < 10 ? 2 : b < 100 ? 1 : 0;
    return `${b.toFixed(d)} ${UNITS[i]}`;
  }
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtDate(ms) {
    if (!ms) return "";
    const d = new Date(ms), n = new Date();
    const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(n) - day(d)) / 864e5);
    if (pref("dates") === "full") return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()} ${hm}`;
    if (diff === 0) return `Today ${hm}`;
    if (diff === 1) return `Yesterday ${hm}`;
    return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`;
  }
  const plural = (n, w) => `${n.toLocaleString()} ${w}${n === 1 ? "" : "s"}`;

  const KINDS = {
    pdf: ["PDF document", "doc"], docx: ["Word document", "doc"], doc: ["Word document", "doc"], odt: ["Document", "doc"], txt: ["Text", "doc"], md: ["Markdown", "doc"], rtf: ["Document", "doc"],
    xlsx: ["Spreadsheet", "table"], xls: ["Spreadsheet", "table"], ods: ["Spreadsheet", "table"], csv: ["CSV", "table"],
    png: ["Image", "image"], jpg: ["Image", "image"], jpeg: ["Image", "image"], heic: ["Image", "image"], gif: ["Image", "image"], webp: ["Image", "image"], svg: ["Image", "image"], bmp: ["Image", "image"],
    mp4: ["Video", "video"], mkv: ["Video", "video"], mov: ["Video", "video"], avi: ["Video", "video"], webm: ["Video", "video"],
    m4a: ["Audio", "audio"], flac: ["Audio", "audio"], mp3: ["Audio", "audio"], wav: ["Audio", "audio"], ogg: ["Audio", "audio"],
    zip: ["ZIP archive", "archive"], "7z": ["7z archive", "archive"], rar: ["RAR archive", "archive"], gz: ["Archive", "archive"], xz: ["Archive", "archive"], tar: ["Archive", "archive"],
    iso: ["Disc image", "disc"], img: ["Disc image", "disc"], exe: ["Application", "app"], msi: ["Installer", "app"], appimage: ["Application", "app"], rpm: ["Package", "archive"], deb: ["Package", "archive"],
    rs: ["Rust source", "doc"], html: ["HTML", "doc"], css: ["Stylesheet", "doc"], js: ["JavaScript", "doc"], ts: ["TypeScript", "doc"], json: ["JSON", "doc"], toml: ["TOML", "doc"], py: ["Python", "doc"],
  };
  const ext = (n) => { const i = n.lastIndexOf("."); return i > 0 ? n.slice(i + 1).toLowerCase() : ""; };
  function kind(e) {
    if (e.drive) return { label: "Drive", icon: e.drive.icon };
    if (e.dir) return { label: "Folder", icon: "folder" };
    const k = KINDS[ext(e.name)];
    return k ? { label: k[0], icon: k[1] } : { label: ext(e.name) ? ext(e.name).toUpperCase() + " file" : "File", icon: "file" };
  }
  // like Explorer, "hide extensions" only hides them for types it knows
  function shownName(e) {
    if (e.dir || e.drive || pref("exts")) return e.name;
    const x = ext(e.name);
    return x && KINDS[x] ? e.name.slice(0, -(x.length + 1)) : e.name;
  }

  /* ---------- system icons (Windows) ---------- */
  const iconCache = new Map(); // key -> data URI, or null while loading / unavailable
  const PER_PATH = new Set(["exe", "lnk", "ico", "url", "scr", "cpl", "msc", "cur", "ani", "appref-ms"]);
  const sysIcons = () => FSX.real && FSX.platform === "windows" && pref("icons") === "system";
  function iconKey(e) {
    if (e.drive) return e.path;
    if (e.dir) return FSX.places().some((p) => p.path === e.path) ? e.path : "dir:";
    const x = ext(e.name);
    return PER_PATH.has(x) ? e.path : "ext:" + x;
  }
  function fileIcon(e, big = false) {
    if (sysIcons()) { const u = iconCache.get(iconKey(e)); if (u) return `<img class="fi${big ? " big" : ""}" src="${u}" alt="">`; }
    return icon(kind(e).icon, e.dir && !big ? "i dir" : "i");
  }
  const iconWant = new Set();
  let iconTimer = null;
  function wantIcons(list) {
    if (!sysIcons()) return;
    list.forEach((e) => { const k = iconKey(e); if (!iconCache.has(k)) iconWant.add(k); });
    if (iconWant.size && !iconTimer) iconTimer = setTimeout(flushIcons, 0);
  }
  async function flushIcons() {
    iconTimer = null;
    const keys = [...iconWant].slice(0, 96);
    keys.forEach((k) => { iconWant.delete(k); iconCache.set(k, null); });
    const got = await FSX.icons(keys).catch(() => ({}));
    Object.entries(got).forEach(([k, u]) => iconCache.set(k, u));
    document.querySelectorAll(".row[data-ik]").forEach((r) => {
      const u = got[r.dataset.ik], s = r.querySelector(".nm svg");
      if (u && s) { const img = new Image(); img.className = "fi"; img.alt = ""; img.src = u; s.replaceWith(img); }
    });
    if (iconWant.size) iconTimer = setTimeout(flushIcons, 0);
  }

  /* ---------- views: Details, Tiles, Medium icons, Large icons ---------- */
  const VIEWS = [["details", "Details", "v-details"], ["tiles", "Tiles", "v-tiles"], ["medium", "Medium icons", "v-medium"], ["large", "Large icons", "v-large"]];
  const THUMB_PX = { tiles: 40, medium: 56, large: 112 }; // CSS size of the picture in each view
  const thumbCache = new Map(); // "size|path" -> data URI, or null while loading / none
  const thumbSize = (v) => Math.min(256, Math.round(THUMB_PX[v] * (window.devicePixelRatio || 1)));
  const useThumbs = () => FSX.real && FSX.platform === "windows" && pref("icons") === "system";
  function tileArt(e, v) {
    if (useThumbs()) {
      const u = thumbCache.get(thumbSize(v) + "|" + e.path);
      if (u) return `<img class="th-img" src="${u}" alt="" draggable="false">`;
    }
    return icon(kind(e).icon, e.dir ? "i dir" : "i");
  }
  // fetch thumbnails only for tiles that scroll into view
  const thumbWant = new Set();
  let thumbTimer = null, thumbBusy = false;
  const thumbObserver = new IntersectionObserver((ents) => {
    ents.forEach((en) => {
      if (!en.isIntersecting) return;
      thumbObserver.unobserve(en.target);
      const k = thumbSize(pref("view")) + "|" + en.target.dataset.path;
      if (!thumbCache.has(k)) thumbWant.add(k);
    });
    if (thumbWant.size && !thumbTimer) thumbTimer = setTimeout(flushThumbs, 30);
  }, { rootMargin: "200px" });
  async function flushThumbs() {
    thumbTimer = null;
    if (thumbBusy) { thumbTimer = setTimeout(flushThumbs, 60); return; }
    const bySize = new Map();
    [...thumbWant].slice(0, 24).forEach((k) => { thumbWant.delete(k); thumbCache.set(k, null); const at = k.indexOf("|"); const sz = +k.slice(0, at); bySize.set(sz, [...(bySize.get(sz) || []), k.slice(at + 1)]); });
    thumbBusy = true;
    for (const [sz, paths] of bySize) {
      const got = await FSX.thumbs(paths, sz).catch(() => ({}));
      Object.entries(got).forEach(([p, u]) => {
        thumbCache.set(sz + "|" + p, u);
        document.querySelectorAll(`.list.grid .row[data-path="${CSS.escape(p)}"] .th`).forEach((th) => { th.innerHTML = `<img class="th-img" src="${u}" alt="" draggable="false">`; th.classList.add("got"); });
      });
    }
    thumbBusy = false;
    if (thumbWant.size) thumbTimer = setTimeout(flushThumbs, 0);
  }
  function setView(v) {
    if (!VIEWS.some((x) => x[0] === v) || v === pref("view")) return;
    store.set("pref.view", v);
    syncViewButton();
    visiblePanes().forEach((i) => renderPane(i, true));
    renderChrome();
  }
  function syncViewButton() {
    const v = VIEWS.find((x) => x[0] === pref("view")) || VIEWS[0];
    $("#viewicon").innerHTML = `<use href="#i-${v[2]}"/>`;
    $("#viewlbl").textContent = v[1];
  }
  function showViewMenu() {
    const r = $("#viewbtn").getBoundingClientRect(), cur = pref("view");
    const m = $("#menu");
    m.innerHTML = VIEWS.map(([v, l, ic], n) => `<button role="menuitemradio" aria-checked="${v === cur}" data-v="${v}">${icon(ic)}${l}<kbd>Ctrl+Shift+${n + 1}</kbd></button>`).join("");
    m.hidden = false;
    m.style.left = Math.min(r.left, innerWidth - m.offsetWidth - 8) + "px";
    m.style.top = r.bottom + 6 + "px";
    m.querySelectorAll("[data-v]").forEach((b) => (b.onclick = () => { m.hidden = true; setView(b.dataset.v); }));
    (m.querySelector("[aria-checked=true]") || m.querySelector("button")).focus();
  }
  // columns in the icon grid, for arrow keys
  function gridCols(i) {
    const rows = paneBox(i).querySelectorAll(".list.grid .row");
    if (rows.length < 2) return 1;
    const top = rows[0].offsetTop; let n = 0;
    for (const r of rows) { if (r.offsetTop !== top) break; n++; }
    return Math.max(1, n);
  }

  /* ---------- paths (Windows "C:\a\b" or Linux "/a/b"; "" is This PC) ---------- */
  const WIN = FSX.platform === "windows";
  function split(p) { if (!p) return []; if (WIN) return p.split("\\").filter(Boolean); return p === "/" ? ["/"] : ["/", ...p.split("/").filter(Boolean)]; }
  function join(parts) { if (!parts.length) return ""; if (WIN) return parts.join("\\"); return parts.length === 1 ? "/" : "/" + parts.slice(1).join("/"); }
  const parentOf = (p) => { const s = split(p); return s.length <= 1 ? "" : join(s.slice(0, -1)); };
  const child = (dir, name) => (WIN ? dir + "\\" + name : dir === "/" ? "/" + name : dir + "/" + name);
  const nameOf = (p) => { const s = split(p); return s[s.length - 1] || ""; };
  function driveOf(p) {
    if (WIN) return split(p)[0] || "";
    return FSX.drives().map((d) => d.id).filter((id) => p === id || p.startsWith(id === "/" ? "/" : id + "/")).sort((a, b) => b.length - a.length)[0] || "/";
  }
  function baseOf(p) {
    if (p === "") return "This PC";
    const d = FSX.drives().find((x) => x.id === p);
    if (d) return d.label;
    return nameOf(p);
  }

  /* ---------- listing cache ---------- */
  const cache = new Map();   // path -> entries
  const sizes = new Map();   // folder path -> bytes (from "Calculate folder sizes")
  let showHidden = store.get("hidden", false);
  async function load(path, force = false) {
    if (!force && cache.has(path)) return cache.get(path);
    const list = await FSX.list(path);
    cache.set(path, list);
    return list;
  }
  const sig = (l) => l.length + ":" + l.reduce((a, e) => a + (e.mtime || 0) % 100000 + e.name.length, 0);

  /* ---------- state ---------- */
  let uid = 0;
  const HOME = FSX.home();
  const newPane = (path) => ({ path, back: [], fwd: [], sel: new Set(), cursor: null, anchor: null, sort: { key: "name", dir: 1 }, filters: {} });
  const newTab = (path, pathB) => ({ id: ++uid, panes: [newPane(path), newPane(pathB || path)] });
  const firstPlace = (label) => (FSX.places().find((p) => p.label === label) || {}).path;
  const savedTabs = store.get("tabs", null);
  function startTabs() {
    if (PICK) return [REQ.folder || store.get("pickerLast", null) || firstPlace("Documents") || HOME];
    const s = pref("startIn");
    if (s === "home") return [HOME];
    if (s === "thispc") return [""];
    if (s === "downloads") return [firstPlace("Downloads") || HOME];
    return savedTabs && savedTabs.length ? savedTabs : [firstPlace("Downloads") || HOME];
  }
  const LAYOUT_KEY = PICK ? "pickerLayout" : "layout";
  const S = {
    tabs: startTabs().map((p) => newTab(p, FSX.real ? HOME : "E:\\Backups")),
    tab: 0,
    pane: 0,
    layout: store.get(LAYOUT_KEY, PICK ? "single" : "preview"),
    side: store.get("side", 236),
    prev: store.get("prev", 340),
    clip: null,
    undo: [],
    xfer: null,
  };
  const tab = () => S.tabs[S.tab];
  const pane = (i = S.pane) => tab().panes[i];
  const visiblePanes = () => (S.layout === "dual" ? [0, 1] : [0]);
  const saveTabs = () => { if (!PICK) store.set("tabs", S.tabs.map((t) => t.panes[0].path)); };

  /* ---------- column filters (like Explorer's column header dropdowns) ---------- */
  const FCOLS = ["name", "mtime", "type", "size"];
  const SIZES = [["Empty (0 KB)", 0, 1], ["Tiny (0 – 16 KB)", 1, 16384], ["Small (16 KB – 1 MB)", 16384, 1048576], ["Medium (1 – 128 MB)", 1048576, 134217728], ["Large (128 MB – 1 GB)", 134217728, 1073741824], ["Huge (1 – 4 GB)", 1073741824, 4294967296], ["Gigantic (over 4 GB)", 4294967296, Infinity]];
  const DATES = ["Today", "Yesterday", "Earlier this week", "Last week", "Earlier this month", "Last month", "Earlier this year", "A long time ago", "No date"];
  const NAMES = ["0 – 9", "A – H", "I – P", "Q – Z", "Other"];
  function dateBucket(ms) {
    if (!ms) return "No date";
    const n = new Date(), d = new Date(ms);
    const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const today = day(n), dd = day(d), diff = Math.round((today - dd) / 864e5);
    if (diff <= 0) return "Today";
    if (diff === 1) return "Yesterday";
    const weekStart = today - ((n.getDay() + 6) % 7) * 864e5; // weeks start on Monday
    if (dd >= weekStart) return "Earlier this week";
    if (dd >= weekStart - 7 * 864e5) return "Last week";
    if (d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth()) return "Earlier this month";
    if (d >= new Date(n.getFullYear(), n.getMonth() - 1, 1)) return "Last month";
    if (d.getFullYear() === n.getFullYear()) return "Earlier this year";
    return "A long time ago";
  }
  function bucket(col, e) {
    if (col === "type") return kind(e).label;
    if (col === "mtime") return dateBucket(e.mtime);
    if (col === "size") { if (e.dir) return "Folders"; const s = e.size || 0; return SIZES.find((b) => s >= b[1] && s < b[2])[0]; }
    const c = (e.name[0] || "").toUpperCase();
    return /[0-9]/.test(c) ? NAMES[0] : /[A-H]/.test(c) ? NAMES[1] : /[I-P]/.test(c) ? NAMES[2] : /[Q-Z]/.test(c) ? NAMES[3] : NAMES[4];
  }
  const bucketOrder = (col, list) => col === "mtime" ? DATES : col === "name" ? NAMES : col === "size" ? ["Folders", ...SIZES.map((s) => s[0])] : [...new Set(list)].sort((a, b) => a.localeCompare(b));
  const filterOn = (p) => FCOLS.some((c) => p.filters[c] && p.filters[c].size) || !!p.filters.text;
  // everything the folder would show before column filters
  const baseList = (p) => (cache.get(p.path) || []).filter((e) => (showHidden || !e.hidden) && pickVisible(e));

  function entries(p) {
    const f = p.filters;
    const text = (f.text || "").toLowerCase();
    const list = baseList(p).filter((e) => FCOLS.every((c) => !f[c] || !f[c].size || f[c].has(bucket(c, e))) && (!text || e.name.toLowerCase().includes(text)));
    const { key, dir } = p.sort;
    const firstFolders = pref("foldersFirst");
    const val = (e) => key === "size" ? (e.dir ? sizes.get(e.path) ?? -1 : e.size) : key === "mtime" ? e.mtime || 0 : key === "type" ? kind(e).label : e.name.toLowerCase();
    return list.slice().sort((a, b) => {
      if (firstFolders && a.dir !== b.dir) return a.dir ? -1 : 1;
      const x = val(a), y = val(b);
      return (x < y ? -1 : x > y ? 1 : a.name.localeCompare(b.name, undefined, { numeric: true })) * dir;
    });
  }

  /* ---------- tabs ---------- */
  function renderTabs() {
    const box = $("#tabs");
    box.innerHTML = "";
    S.tabs.forEach((t, i) => {
      const b = el("div", t.fresh ? "tab new" : "tab");
      t.fresh = false;
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", i === S.tab);
      b.tabIndex = i === S.tab ? 0 : -1;
      b.title = t.panes[0].path || "This PC";
      b.innerHTML = `<span class="label">${esc(baseOf(t.panes[0].path))}</span><button class="close" aria-label="Close tab">${icon("x")}</button>`;
      b.onmousedown = (e) => { if (e.button === 1) { e.preventDefault(); closeTab(i); } };
      b.onclick = (e) => { if (e.target.closest(".close")) closeTab(i); else selectTab(i); };
      box.appendChild(b);
    });
    saveTabs();
  }
  async function selectTab(i) {
    S.tab = i; S.pane = 0;
    await Promise.all(visiblePanes().map((x) => load(pane(x).path).catch(() => { pane(x).path = HOME; return load(HOME); })));
    renderAll(true);
  }
  function addTab(path) { const t = newTab(path || HOME, FSX.real ? HOME : "E:\\Backups"); t.fresh = true; S.tabs.push(t); selectTab(S.tabs.length - 1); }
  function closeTab(i) {
    if (S.tabs.length === 1) { S.tabs[0] = newTab(HOME); S.tab = 0; return selectTab(0); }
    S.tabs.splice(i, 1);
    if (S.tab >= S.tabs.length) S.tab = S.tabs.length - 1;
    else if (i < S.tab) S.tab--;
    selectTab(S.tab);
  }

  /* ---------- toolbar ---------- */
  function renderPath() {
    const p = pane(), nav = $("#path");
    nav.innerHTML = "";
    const parts = split(p.path);
    const crumbs = [["This PC", ""]];
    parts.forEach((seg, i) => { const path = join(parts.slice(0, i + 1)); crumbs.push([i === 0 ? baseOf(path) : seg, path]); });
    crumbs.forEach(([label, path], i) => {
      if (i) nav.appendChild(el("span", "crumbsep", icon("chev")));
      const c = el("button", "crumb", esc(label));
      if (i === crumbs.length - 1) c.setAttribute("aria-current", "page");
      c.onclick = () => go(S.pane, path);
      c.ondragover = (e) => { if (path) { e.preventDefault(); c.classList.add("drop"); } };
      c.ondragleave = () => c.classList.remove("drop");
      c.ondrop = (e) => { c.classList.remove("drop"); onDrop(e, path); };
      nav.appendChild(c);
    });
    nav.ondblclick = (e) => { if (e.target === nav) editPath(); };
    requestAnimationFrame(() => { nav.scrollLeft = nav.scrollWidth; });
    $("#back").disabled = !p.back.length;
    $("#fwd").disabled = !p.fwd.length;
    $("#up").disabled = p.path === "";
  }
  function editPath() {
    const nav = $("#path");
    const inp = el("input", "pathedit");
    inp.value = pane().path; inp.setAttribute("aria-label", "Type a location");
    nav.innerHTML = ""; nav.appendChild(inp); inp.focus(); inp.select();
    const done = (goTo) => { const v = inp.value.trim(); renderPath(); if (goTo && v) go(S.pane, v.replace(/[\\/]+$/, "") || (WIN ? v : "/")); };
    inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === "Enter") done(true); if (e.key === "Escape") done(false); };
    inp.onblur = () => done(false);
  }

  /* ---------- layout ---------- */
  function applyLayout() {
    const r = document.documentElement.style;
    r.setProperty("--side", S.side + "px");
    r.setProperty("--prev", S.prev + "px");
    r.setProperty("--dual", S.layout === "dual" ? "1fr" : "0fr");
    r.setProperty("--prev-on", S.layout === "preview" ? 1 : 0);
    $("#col-b").classList.toggle("off", S.layout !== "dual");
    $("#col-prev").classList.toggle("off", S.layout !== "preview");
    $("#body").classList.toggle("dualmode", S.layout === "dual");
    const idx = ["single", "dual", "preview"].indexOf(S.layout);
    $("#segthumb").style.transform = `translateX(${idx * 36}px)`;
    document.querySelectorAll(".seg button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.layout === S.layout));
    if (S.layout !== "dual" && S.pane === 1) S.pane = 0;
  }
  // Signature move: panels glide to their new places. Transform + clip-path only;
  // content snaps to its final layout, so large folders never re-lay out per frame.
  const reduceMotion = () => pref("motion") === "reduced" || matchMedia("(prefers-reduced-motion: reduce)").matches;
  async function setLayout(l) {
    if (l === S.layout) return;
    if (l === "dual") await load(pane(1).path).catch(() => { pane(1).path = HOME; return load(HOME); });
    const cols = ["#col-side", "#col-a", "#col-b", "#col-prev"].map((s) => $(s));
    const before = cols.map((c) => (c.classList.contains("off") ? null : c.querySelector(".panel").getBoundingClientRect()));
    const ghosts = reduceMotion() ? [] : cols.map((c, i) => {
      if (!before[i]) return null;
      const r = before[i], g = c.querySelector(".panel").cloneNode(true);
      g.removeAttribute("id"); g.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
      g.classList.add("ghost");
      Object.assign(g.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
      return g;
    });
    S.layout = l; store.set(LAYOUT_KEY, l);
    applyLayout();
    renderAll(l === "dual");
    if (reduceMotion()) return;
    const ease = "cubic-bezier(.22, 1, .36, 1)";
    cols.forEach((c, i) => {
      const g = ghosts[i];
      if (!g || !c.classList.contains("off")) return;
      document.body.appendChild(g);
      g.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateX(24px)" }], { duration: 240, easing: ease, fill: "forwards" })
        .finished.then(() => g.remove(), () => g.remove());
      setTimeout(() => g.remove(), 450);
    });
    cols.forEach((c, i) => {
      if (c.classList.contains("off")) return;
      const p = c.querySelector(".panel"), a = before[i], b = p.getBoundingClientRect();
      if (!a) { p.animate([{ opacity: 0, transform: "translateX(24px)" }, { opacity: 1, transform: "none" }], { duration: 300, easing: ease }); return; }
      const dx = a.left - b.left, dw = a.width - b.width;
      if (Math.abs(dx) < 1 && Math.abs(dw) < 1) return;
      const from = dw < 0 ? `inset(0 ${-dw}px 0 0 round 12px)` : "inset(0 0 0 0 round 12px)";
      p.animate([{ transform: `translateX(${dx}px)`, clipPath: from }, { transform: "none", clipPath: "inset(0 0 0 0 round 12px)" }], { duration: 300, easing: ease });
    });
  }

  /* ---------- sidebar ---------- */
  const defaultMarks = () => (FSX.real ? [] : [["Projects", HOME + "\\Projects"], ["Invoices 2026", HOME + "\\Documents\\Invoices 2026"]]);
  function renderSide() {
    const side = $("#side"), cur = pane().path;
    const marks = store.get("bookmarks", defaultMarks());
    const nav = (label, path, ic, extra = "", mark = false) =>
      `<button class="nav" data-path="${esc(path)}"${mark ? " data-mark" : ""}${cur === path ? ' aria-current="true"' : ""} title="${esc(path || "This PC")}">${icon(ic)}<span>${esc(label)}</span>${extra}</button>`;
    let h = `<h2>Quick access</h2>`;
    FSX.places().forEach((pl) => {
      const n = cur === pl.path ? entries(pane()).length : null;
      h += nav(pl.label, pl.path, pl.icon, n != null ? `<small class="num">${n.toLocaleString()}</small>` : "");
    });
    h += `<h2>Bookmarks</h2>`;
    if (!marks.length) h += `<p class="hint">Right-click a folder and choose Add to bookmarks.</p>`;
    marks.forEach(([l, p]) => (h += nav(l, p, "star", "", true)));
    h += `<h2>Drives</h2>`;
    h += nav("This PC", "", "pc");
    FSX.drives().forEach((d) => {
      const used = d.total ? 1 - d.free / d.total : 0;
      h += `<button class="nav drive" data-path="${esc(d.id)}"${cur === d.id ? ' aria-current="true"' : ""}><span class="top">${icon(d.icon)}<span>${esc(d.label)}</span><small class="num">${fmtSize(d.free)} free</small></span><span class="track"><i style="width:${(used * 100).toFixed(1)}%"></i></span></button>`;
    });
    if (FSX.simulated) h += `<div class="sample">Showing sample files and simulated transfer speeds. Install the Slate app to browse your real folders.</div>`;
    side.innerHTML = h;
    side.querySelectorAll(".nav").forEach((b) => {
      b.onclick = () => go(S.pane, b.dataset.path);
      b.ondragover = (e) => { if (b.dataset.path) { e.preventDefault(); b.classList.add("drop"); } };
      b.ondragleave = () => b.classList.remove("drop");
      b.ondrop = (e) => { b.classList.remove("drop"); onDrop(e, b.dataset.path); };
      if (b.hasAttribute("data-mark")) b.oncontextmenu = (e) => { e.preventDefault(); showMenu(e, [["unmark", "Remove from bookmarks", "x", ""]], () => {
        store.set("bookmarks", store.get("bookmarks", defaultMarks()).filter((m) => m[1] !== b.dataset.path)); renderSide();
      }); };
    });
  }

  /* ---------- file pane ---------- */
  const COLS = [["name", "Name", ""], ["mtime", "Modified", "c-mod"], ["type", "Type", "c-type"], ["size", "Size", "r"]];
  const paneBox = (i) => (i === 0 ? $("#pane-a") : $("#pane-b"));
  function renderPane(i, animateRows = false) {
    const box = paneBox(i);
    const p = pane(i);
    box.classList.toggle("focused", S.layout === "dual" && S.pane === i);
    const list = entries(p);
    const old = box.querySelector(".list");
    const prevScroll = old ? old.scrollTop : 0;
    let h = `<div class="panehead">${icon(p.path === "" ? "pc" : "folder")}<b>${esc(baseOf(p.path))}</b><span class="num" style="margin-left:auto">${plural(list.length, "item")}</span></div>`;
    const fOn = (k) => (k === "name" ? (p.filters.name && p.filters.name.size) || p.filters.text : p.filters[k] && p.filters[k].size);
    h += `<div class="cols">${COLS.map(([k, label, cls]) => `<div class="${cls}"><button data-sort="${k}"${p.sort.key === k ? ` aria-sort="${p.sort.dir > 0 ? "ascending" : "descending"}"` : ""}>${label}${p.sort.key === k ? icon("up") : ""}</button><button class="fbtn${fOn(k) ? " on" : ""}" data-filter="${k}" aria-label="Filter by ${label.toLowerCase()}" aria-haspopup="menu" title="Filter by ${label.toLowerCase()}">${icon(fOn(k) ? "filter" : "sort")}</button></div>`).join("")}</div>`;
    if (filterOn(p)) {
      const names = { name: "Name", mtime: "Modified", type: "Type", size: "Size" };
      const chips = [];
      if (p.filters.text) chips.push(["text", `Name contains “${esc(p.filters.text)}”`]);
      FCOLS.forEach((c) => { const s = p.filters[c]; if (s && s.size) chips.push([c, `${names[c]}: ${[...s].map(esc).join(", ")}`]); });
      h += `<div class="fstrip">${icon("filter")}${chips.map(([c, t]) => `<button class="chip" data-unfilter="${c}" title="Remove this filter"><span>${t}</span>${icon("x")}</button>`).join("")}<span class="num fcount">${list.length.toLocaleString()} of ${baseList(p).length.toLocaleString()}</span><button class="link" data-unfilter="all">Clear filters</button></div>`;
    }
    const view = pref("view"), grid = view !== "details";
    h += `<div class="list${grid ? " grid v-" + view : ""}" tabindex="0" role="listbox" aria-multiselectable="true" aria-label="${esc(baseOf(p.path))}">`;
    if (!list.length) h += filterOn(p)
      ? `<div class="empty"><div><b>Nothing matches these filters</b>${plural(baseList(p).length, "item")} here are hidden by the filters above.</div></div>`
      : `<div class="empty"><div><b>This folder is empty</b>${PICK ? "Choose another folder." : "Drop files here, or press Ctrl+Shift+N to make a new folder."}</div></div>`;
    // render in one string; rows beyond the first screen skip the entrance animation
    const rows = [];
    for (let n = 0; n < list.length; n++) {
      const e = list[n], k = kind(e);
      const sel = p.sel.has(e.path);
      const cut = S.clip && S.clip.mode === "cut" && S.clip.paths.includes(e.path);
      const sz = e.drive ? `${fmtSize(e.drive.free)} free` : e.dir ? (sizes.has(e.path) ? fmtSize(sizes.get(e.path)) : e.items != null ? plural(e.items, "item") : "") : fmtSize(e.size);
      const anim = animateRows && n < 24;
      if (grid) {
        const cls = `row${anim ? " enter" : ""}${p.cursor === e.path ? " cursor" : ""}${cut ? " cut" : ""}${e.hidden ? " hid" : ""}`;
        const meta = view === "tiles" ? `<div class="meta"><span class="sub">${k.label}</span><span class="sub num">${sz}</span></div>` : "";
        rows.push(`<div class="${cls}" role="option" aria-selected="${sel}" draggable="true" data-path="${esc(e.path)}" title="${esc(e.name)}"${anim ? ` style="animation-delay:${n * 10}ms"` : ""}><div class="nm"><div class="th">${tileArt(e, view)}</div><span>${esc(shownName(e))}</span></div>${meta}</div>`);
        continue;
      }
      rows.push(`<div class="row${anim ? " enter" : ""}${p.cursor === e.path ? " cursor" : ""}${cut ? " cut" : ""}${e.hidden ? " hid" : ""}" role="option" aria-selected="${sel}" draggable="true" data-path="${esc(e.path)}"${anim ? ` style="animation-delay:${n * 12}ms"` : ""}${sysIcons() ? ` data-ik="${esc(iconKey(e))}"` : ""}><div class="nm">${fileIcon(e)}<span>${esc(shownName(e))}</span></div><span class="sub c-mod num">${fmtDate(e.mtime)}</span><span class="sub c-type">${k.label}</span><span class="sub r num">${sz}</span></div>`);
    }
    h += rows.join("") + `</div>`;
    box.innerHTML = h;
    const lst = box.querySelector(".list");
    if (!animateRows) lst.scrollTop = prevScroll;
    box.querySelectorAll("[data-sort]").forEach((b) => (b.onclick = () => {
      const k = b.dataset.sort;
      p.sort = p.sort.key === k ? { key: k, dir: -p.sort.dir } : { key: k, dir: k === "name" || k === "type" ? 1 : -1 };
      renderPane(i);
    }));
    box.querySelectorAll("[data-filter]").forEach((b) => (b.onclick = (ev) => { ev.stopPropagation(); showFilterMenu(b, b.dataset.filter, i); }));
    box.querySelectorAll("[data-unfilter]").forEach((b) => (b.onclick = () => {
      const c = b.dataset.unfilter;
      if (c === "all") p.filters = {}; else if (c === "text") p.filters.text = ""; else delete p.filters[c];
      renderPane(i); renderChrome();
    }));
    if (grid) { if (useThumbs()) lst.querySelectorAll(".row").forEach((r) => { if (!thumbCache.get(thumbSize(view) + "|" + r.dataset.path)) thumbObserver.observe(r); }); }
    else wantIcons(list);
    // Ctrl+scroll steps through the views, like Explorer
    lst.addEventListener("wheel", (ev) => {
      if (!ev.ctrlKey) return;
      ev.preventDefault();
      const now = Date.now(); if (now - (lst._wheelAt || 0) < 180) return; lst._wheelAt = now;
      const at = VIEWS.findIndex((x) => x[0] === pref("view"));
      const to = Math.max(0, Math.min(VIEWS.length - 1, at + (ev.deltaY < 0 ? 1 : -1)));
      setView(VIEWS[to][0]);
    }, { passive: false });
    lst.addEventListener("mousedown", (ev) => onRowDown(ev, i));
    lst.addEventListener("dblclick", (ev) => { const r = ev.target.closest(".row"); if (r && !pref("singleClick")) open(i, r.dataset.path); });
    lst.addEventListener("click", (ev) => {
      if (!pref("singleClick") || ev.ctrlKey || ev.shiftKey || ev.metaKey || dragging) return;
      const r = ev.target.closest(".row"); if (r && !r.classList.contains("renaming")) open(i, r.dataset.path);
    });
    lst.addEventListener("auxclick", (ev) => {
      // middle-click a folder: open it in a new tab
      const r = ev.target.closest(".row"); if (ev.button !== 1 || !r || PICK) return;
      const e = rowsOf(i).find((x) => x.path === r.dataset.path);
      if (e && e.dir) { ev.preventDefault(); addTab(e.path); }
    });
    lst.addEventListener("contextmenu", (ev) => onContext(ev, i));
    lst.addEventListener("focus", () => { if (S.pane !== i) { S.pane = i; renderChrome(); markFocus(); } });
    lst.addEventListener("dragstart", (ev) => onDragStart(ev, i));
    lst.addEventListener("dragover", (ev) => onDragOver(ev, i));
    lst.addEventListener("dragleave", () => lst.querySelectorAll(".drop").forEach((x) => x.classList.remove("drop")));
    lst.addEventListener("drop", (ev) => {
      const r = ev.target.closest(".row");
      const e = r && entries(pane(i)).find((x) => x.path === r.dataset.path);
      onDrop(ev, e && e.dir ? e.path : pane(i).path);
    });
  }
  function markFocus() { [0, 1].forEach((i) => paneBox(i).classList.toggle("focused", S.layout === "dual" && S.pane === i)); }

  // the dropdown on a column header: tick values to show only those items
  function showFilterMenu(anchor, col, i) {
    const m = $("#fmenu"), p = pane(i), key = `${i}:${col}`;
    if (!m.hidden && m.dataset.for === key) { m.hidden = true; return; }
    m.dataset.for = key;
    const draw = () => {
      const all = baseList(p);
      const counts = new Map();
      all.forEach((e) => { const b = bucket(col, e); counts.set(b, (counts.get(b) || 0) + 1); });
      const set = p.filters[col] || new Set();
      const order = bucketOrder(col, [...counts.keys()]).filter((b) => counts.has(b) || set.has(b));
      let h = col === "name" ? `<div class="ftext">${icon("search")}<input id="f-text" placeholder="Name contains" value="${esc(p.filters.text || "")}" spellcheck="false" autocomplete="off"></div>` : "";
      h += order.length ? order.map((b) => `<button role="menuitemcheckbox" aria-checked="${set.has(b)}" data-b="${esc(b)}"><span class="cb">${icon("check")}</span><span class="bl">${esc(b)}</span><kbd class="num">${(counts.get(b) || 0).toLocaleString()}</kbd></button>`).join("")
        : `<p class="none">Nothing to filter in this folder</p>`;
      h += `<hr><button data-clear${set.size || (col === "name" && p.filters.text) ? "" : " disabled"}>${icon("x")}Clear this filter</button>`;
      m.innerHTML = h;
      m.querySelectorAll("[data-b]").forEach((b) => (b.onclick = () => {
        const s = p.filters[col] || (p.filters[col] = new Set());
        s.has(b.dataset.b) ? s.delete(b.dataset.b) : s.add(b.dataset.b);
        if (!s.size) delete p.filters[col];
        renderPane(i); renderChrome(); draw();
        const again = m.querySelector(`[data-b="${CSS.escape(b.dataset.b)}"]`); if (again) again.focus();
      }));
      m.querySelector("[data-clear]").onclick = () => { delete p.filters[col]; if (col === "name") p.filters.text = ""; renderPane(i); renderChrome(); m.hidden = true; focusList(i); };
      const t = m.querySelector("#f-text");
      if (t) {
        t.oninput = () => { p.filters.text = t.value; renderPane(i); renderChrome(); };
        t.onkeydown = (e) => { e.stopPropagation(); if (e.key === "Escape" || e.key === "Enter") { m.hidden = true; focusList(i); } };
      }
    };
    draw();
    m.hidden = false;
    const r = anchor.getBoundingClientRect();
    const w = m.offsetWidth;
    m.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + "px";
    m.style.top = Math.min(r.bottom + 6, innerHeight - m.offsetHeight - 8) + "px";
    const first = m.querySelector("#f-text") || m.querySelector("button:not([disabled])");
    if (first) first.focus();
  }
  document.addEventListener("mousedown", (e) => { if (!e.target.closest("#fmenu") && !e.target.closest("[data-filter]")) $("#fmenu").hidden = true; });
  const rowsOf = (i) => entries(pane(i));
  const rowEl = (i, path) => paneBox(i).querySelector(`.row[data-path="${CSS.escape(path)}"]`);

  function onRowDown(ev, i) {
    if (ev.target.closest("input")) return;
    const p = pane(i);
    if (S.pane !== i) { S.pane = i; markFocus(); }
    const r = ev.target.closest(".row");
    if (!r) { if (ev.button === 0) { p.sel.clear(); p.cursor = null; refreshSelection(i); } return; }
    const path = r.dataset.path;
    if ((ev.button === 2 || ev.button === 0) && p.sel.has(path) && !ev.ctrlKey && !ev.shiftKey && !ev.metaKey) { p.cursor = path; p._pending = ev.button === 0 ? path : null; refreshSelection(i); return; }
    if (ev.shiftKey && p.anchor) {
      const list = rowsOf(i).map((e) => e.path);
      const a = list.indexOf(p.anchor), b = list.indexOf(path);
      if (!ev.ctrlKey) p.sel.clear();
      list.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((x) => p.sel.add(x));
    } else if (ev.ctrlKey || ev.metaKey) {
      p.sel.has(path) ? p.sel.delete(path) : p.sel.add(path);
      p.anchor = path;
    } else {
      p.sel.clear(); p.sel.add(path); p.anchor = path;
    }
    p.cursor = path;
    refreshSelection(i);
  }
  document.addEventListener("mouseup", (ev) => {
    // a plain click on an already-selected row (without dragging) narrows the selection to it
    visiblePanes().forEach((i) => { const p = pane(i); if (p._pending && ev.button === 0 && !dragging) { p.sel = new Set([p._pending]); p.anchor = p._pending; refreshSelection(i); } p._pending = null; });
  });
  function refreshSelection(i) {
    const p = pane(i);
    paneBox(i).querySelectorAll(".row").forEach((r) => {
      r.setAttribute("aria-selected", p.sel.has(r.dataset.path));
      r.classList.toggle("cursor", p.cursor === r.dataset.path);
    });
    if (PICK) p_sync(i);
    renderChrome();
  }

  /* ---------- drag and drop ---------- */
  let dragging = null;
  function onDragStart(ev, i) {
    const r = ev.target.closest(".row"); if (!r) return;
    const p = pane(i);
    if (!p.sel.has(r.dataset.path)) { p.sel = new Set([r.dataset.path]); refreshSelection(i); }
    dragging = { from: i, paths: [...p.sel] };
    ev.dataTransfer.effectAllowed = "copyMove";
    ev.dataTransfer.setData("text/plain", dragging.paths.join("\n"));
    const g = el("div", "dragchip num", `${icon("copy")}${plural(dragging.paths.length, "item")}`);
    document.body.appendChild(g); ev.dataTransfer.setDragImage(g, 12, 12); setTimeout(() => g.remove(), 0);
  }
  function onDragOver(ev, i) {
    if (!dragging) return;
    ev.preventDefault();
    const r = ev.target.closest(".row");
    const lst = paneBox(i).querySelector(".list");
    lst.querySelectorAll(".drop").forEach((x) => x.classList.remove("drop"));
    const e = r && rowsOf(i).find((x) => x.path === r.dataset.path);
    if (e && e.dir && !dragging.paths.includes(e.path)) r.classList.add("drop");
    ev.dataTransfer.dropEffect = ev.ctrlKey ? "copy" : "move";
  }
  function onDrop(ev, dest) {
    ev.preventDefault();
    document.querySelectorAll(".drop").forEach((x) => x.classList.remove("drop"));
    if (!dragging || !dest) { dragging = null; return; }
    const paths = dragging.paths.filter((p) => p !== dest && parentOf(p) !== dest);
    dragging = null;
    if (!paths.length) return;
    // like Explorer: same drive moves, different drive copies; Ctrl forces copy, Shift forces move
    const sameDrive = paths.every((p) => driveOf(p) === driveOf(dest));
    const mode = ev.ctrlKey ? "copy" : ev.shiftKey ? "move" : sameDrive ? "move" : "copy";
    runTransfer(mode, paths, dest);
  }
  document.addEventListener("dragend", () => { dragging = null; document.querySelectorAll(".drop").forEach((x) => x.classList.remove("drop")); });

  /* ---------- navigation ---------- */
  async function go(i, path, push = true) {
    const p = pane(i);
    if (path === p.path) return refresh([path]);
    try { await load(path, true); }
    catch (e) { toast(err(e)); return; }
    if (push) { p.back.push(p.path); p.fwd = []; }
    const from = p.path;
    p.path = path; p.sel.clear(); p.anchor = null; p.cursor = null; p.filters = {};
    $("#fmenu").hidden = true;
    // returning to a parent re-selects the folder you came from
    if (from && (path === "" ? true : from.startsWith(path))) {
      const hit = (cache.get(path) || []).find((e) => from === e.path || from.startsWith(child(e.path, "")));
      if (hit) { p.cursor = hit.path; p.sel.add(hit.path); p.anchor = hit.path; }
    }
    renderPane(i, true);
    renderAll();
    focusList(i);
    if (p.cursor) { const r = rowEl(i, p.cursor); if (r) r.scrollIntoView({ block: "center" }); }
  }
  async function back() { const p = pane(); if (!p.back.length) return; const to = p.back.pop(); p.fwd.push(p.path); await go(S.pane, to, false); }
  async function fwd() { const p = pane(); if (!p.fwd.length) return; const to = p.fwd.pop(); p.back.push(p.path); await go(S.pane, to, false); }
  function up() { const p = pane(); if (p.path !== "") go(S.pane, parentOf(p.path)); }
  function open(i, path) {
    const e = rowsOf(i).find((x) => x.path === path);
    if (!e) return;
    if (e.dir) go(i, e.path);
    else if (PICK) { p_sync(i); pickConfirm(); }
    else if (FSX.real) FSX.open(e.path).catch((x) => toast(err(x)));
    else toast(`Opening ${e.name} with its default app`);
  }
  function focusList(i) { const l = paneBox(i).querySelector(".list"); if (l && document.activeElement !== l) l.focus({ preventScroll: true }); }

  /** Re-read folders from disk and re-render if anything changed. */
  async function refresh(paths) {
    const uniq = [...new Set(paths)];
    let changed = false;
    await Promise.all(uniq.map(async (path) => {
      const before = cache.get(path);
      try { const after = await load(path, true); if (!before || sig(before) !== sig(after)) changed = true; }
      catch { cache.delete(path); changed = true; }
    }));
    if (!changed) return;
    visiblePanes().forEach((i) => {
      const p = pane(i);
      if (!cache.has(p.path)) { p.path = parentOf(p.path) || HOME; load(p.path).then(() => renderPane(i)); return; }
      const live = new Set((cache.get(p.path) || []).map((e) => e.path));
      p.sel.forEach((s) => { if (!live.has(s)) p.sel.delete(s); });
      if (uniq.includes(p.path)) renderPane(i);
    });
    renderChrome();
  }
  const visiblePaths = () => visiblePanes().map((i) => pane(i).path);

  /* ---------- preview ---------- */
  function selected(i = S.pane) { const p = pane(i); return rowsOf(i).filter((e) => p.sel.has(e.path)); }
  const HASHABLE = new Set(["iso", "img", "zip", "7z", "exe", "msi", "appimage", "rpm", "deb", "tar", "gz", "xz"]);
  let prevToken = 0;
  function renderPreview() {
    if (S.layout !== "preview") return;
    const box = $("#prev"), sel = selected(0), token = ++prevToken;
    if (!sel.length) {
      const list = rowsOf(0);
      box.innerHTML = `<div class="none">${icon("info")}<p style="margin-top:10px">Select a file to see its details.</p><p class="num" style="margin-top:4px;color:var(--text-3)">${plural(list.length, "item")} in ${esc(baseOf(pane(0).path))}</p></div>`;
      return;
    }
    if (sel.length > 1) {
      const files = sel.filter((e) => !e.dir), folders = sel.filter((e) => e.dir);
      const fileBytes = files.reduce((a, e) => a + (e.size || 0), 0);
      box.innerHTML = `<div class="art">${icon("copy")}</div><h3 class="num">${plural(sel.length, "item")} selected</h3><div class="meta num" id="pv-total">${folders.length ? "Calculating size…" : fmtSize(fileBytes) + " in total"}</div>
        <dl class="kv num"><dt>Folders</dt><dd>${folders.length}</dd><dt>Files</dt><dd>${files.length}</dd><dt>Location</dt><dd style="word-break:normal">${esc(pane(0).path || "This PC").replace(/[\\/]/g, "$&<wbr>")}</dd></dl>
        <div class="acts"><button class="btn primary" data-act="copyto">${icon("copy")}Copy to…</button><button class="btn" data-act="moveto">Move to…</button><button class="btn" data-act="rename">Rename…</button></div>`;
      if (folders.length) Promise.all(folders.map((f) => folderBytes(f.path))).then((b) => { if (token === prevToken && $("#pv-total")) $("#pv-total").textContent = fmtSize(fileBytes + b.reduce((a, x) => a + x, 0)) + " in total"; });
    } else {
      const e = sel[0], k = kind(e);
      const sz = e.drive ? fmtSize(e.drive.total) : e.dir ? (sizes.has(e.path) ? fmtSize(sizes.get(e.path)) : "Calculating size…") : fmtSize(e.size);
      const loc = esc(parentOf(e.path) || "This PC").replace(/[\\/]/g, "$&<wbr>");
      const rows = e.drive
        ? `<dt>Free</dt><dd>${fmtSize(e.drive.free)}</dd><dt>Capacity</dt><dd>${fmtSize(e.drive.total)}</dd>`
        : `<dt>Modified</dt><dd>${fmtDate(e.mtime)}</dd>${e.dir ? `<dt>Contains</dt><dd id="pv-count">…</dd>` : `<dt>Type</dt><dd>${k.label}${ext(e.name) ? ` (.${esc(ext(e.name))})` : ""}</dd>`}<dt>Location</dt><dd style="word-break:normal">${loc}</dd>${!e.dir && HASHABLE.has(ext(e.name)) ? `<dt>SHA-256</dt><dd id="hash"><button class="link" data-act="hash">Calculate</button></dd>` : ""}`;
      box.innerHTML = `<div class="art">${fileIcon(e, true)}${e.dir || e.drive ? "" : `<span class="ext">${esc(ext(e.name).toUpperCase())}</span>`}</div>
        <h3>${esc(e.name)}</h3><div class="meta num"><span id="pv-size">${sz}</span> · ${k.label}</div>
        <dl class="kv num">${rows}</dl>
        <div class="acts"><button class="btn primary" data-act="open">${icon("open")}Open</button>${e.drive ? "" : `<button class="btn" data-act="copyto">Copy to…</button><button class="btn" data-act="moveto">Move to…</button>`}</div>`;
      if (e.dir && !e.drive) FSX.dirSize(e.path).then((d) => {
        sizes.set(e.path, d.bytes);
        if (token !== prevToken) return;
        if ($("#pv-size")) $("#pv-size").textContent = fmtSize(d.bytes);
        if ($("#pv-count")) $("#pv-count").textContent = FSX.real ? `${plural(d.files, "file")}, ${plural(d.dirs, "folder")}` : plural(e.items || 0, "item");
      }).catch(() => { if ($("#pv-size")) $("#pv-size").textContent = "Size unavailable"; });
    }
    box.querySelectorAll("[data-act]").forEach((b) => (b.onclick = () => (b.dataset.act === "hash" ? hashPreview(sel[0], token) : act(b.dataset.act, 0))));
  }
  function folderBytes(path) { return sizes.has(path) ? Promise.resolve(sizes.get(path)) : FSX.dirSize(path).then((d) => (sizes.set(path, d.bytes), d.bytes)).catch(() => 0); }
  function hashPreview(e, token) {
    const dd = $("#hash"); if (!dd) return;
    dd.textContent = "Calculating…";
    FSX.sha256(e.path).then((hex) => {
      if (token !== prevToken || !$("#hash")) return;
      $("#hash").innerHTML = `<span class="hash">${hex}</span>${FSX.simulated ? `<br><span style="color:var(--text-3)">Sample value</span>` : ""}`;
    }).catch((x) => { if ($("#hash")) $("#hash").textContent = err(x); });
  }

  /* ---------- status ---------- */
  function renderStatus() {
    const list = rowsOf(S.pane), sel = selected();
    const hidden = showHidden ? 0 : (cache.get(pane().path) || []).filter((e) => e.hidden).length;
    const filtered = baseList(pane()).length - list.length;
    $("#st-count").textContent = plural(list.length, "item") + (filtered > 0 ? ` · ${filtered.toLocaleString()} filtered out` : "") + (hidden > 0 ? ` · ${hidden} hidden` : "");
    if (sel.length) {
      const total = sel.reduce((a, e) => a + (e.dir ? 0 : e.size || 0), 0);
      $("#st-sel").textContent = `${sel.length.toLocaleString()} selected${total ? " · " + fmtSize(total) : ""}`;
    } else $("#st-sel").textContent = "";
    const d = FSX.drives().find((x) => x.id === driveOf(pane().path));
    $("#st-drv").textContent = pane().path && d ? `${d.label} · ${fmtSize(d.free)} free of ${fmtSize(d.total)}` : plural(FSX.drives().length, "drive");
  }

  function renderChrome() { renderTabs(); renderPath(); renderSide(); renderPreview(); renderStatus(); }
  function renderAll(panes = false) {
    if (panes) visiblePanes().forEach((i) => renderPane(i, true));
    else if (S.layout === "dual") renderPane(S.pane === 0 ? 1 : 0);
    renderChrome();
  }

  /* ---------- actions ---------- */
  function act(name, i = S.pane) {
    const sel = selected(i);
    switch (name) {
      case "open": if (sel[0]) open(i, sel[0].path); break;
      case "copy": case "cut":
        if (!sel.length) return;
        S.clip = { mode: name, paths: sel.map((e) => e.path) };
        toast(`${plural(sel.length, "item")} ${name === "cut" ? "cut" : "copied"}. Paste with Ctrl+V.`);
        visiblePanes().forEach((x) => renderPane(x));
        break;
      case "paste": paste(i); break;
      case "copyto": case "moveto": if (sel.length) chooseDest(name === "moveto" ? "move" : "copy", sel); break;
      case "rename": if (sel.length === 1) startRename(i, sel[0].path); else if (sel.length > 1) batchRename(i, sel); break;
      case "delete": del(i, sel); break;
      case "delete-permanent": confirmPermanent(i, sel); break;
      case "newfolder": newFolder(i); break;
      case "newtab": addTab(sel[0] && sel[0].dir ? sel[0].path : pane(i).path); break;
      case "selectall": { const p = pane(i); rowsOf(i).forEach((e) => p.sel.add(e.path)); refreshSelection(i); break; }
      case "sizes": calcSizes(i); break;
      case "dupes": findDupes(sel[0] && sel[0].dir ? sel[0].path : pane(i).path); break;
      case "copypath": navigator.clipboard.writeText(sel.map((e) => e.path).join("\n")).then(() => toast(sel.length > 1 ? "Paths copied" : "Path copied"), () => toast("Couldn't copy to the clipboard")); break;
      case "bookmark": {
        const e = sel[0]; if (!e || !e.dir) return;
        const m = store.get("bookmarks", defaultMarks());
        if (!m.some((x) => x[1] === e.path)) { m.push([e.name, e.path]); store.set("bookmarks", m); }
        renderSide(); toast(`Bookmarked ${e.name}`);
        break;
      }
    }
  }

  async function del(i, sel, confirmed = false) {
    if (!sel.length || pane(i).path === "") return;
    if (pref("confirmTrash") && !confirmed) {
      return modal({
        title: `Move ${sel.length === 1 ? sel[0].name : plural(sel.length, "item")} to the ${WIN ? "Recycle Bin" : "Trash"}?`,
        sub: "You can undo this with Ctrl+Z, or restore from the " + (WIN ? "Recycle Bin." : "Trash."),
        ok: "Move to " + (WIN ? "Recycle Bin" : "Trash"),
        onOk: () => del(i, sel, true),
      });
    }
    const paths = sel.map((e) => e.path);
    try { await FSX.trash(paths); }
    catch (e) { return toast(err(e)); }
    const p = pane(i); p.sel.clear(); p.cursor = null;
    S.undo.push({ label: "delete", undo: async () => { const n = await FSX.restore(paths); await refresh(paths.map(parentOf)); if (n < paths.length) toast(`Restored ${n} of ${paths.length}. The rest are still in the Recycle Bin.`); } });
    await refresh([pane(i).path]);
    toast(`Moved ${plural(paths.length, "item")} to the ${WIN ? "Recycle Bin" : "Trash"}`, "Undo");
  }
  function confirmPermanent(i, sel) {
    if (!sel.length || pane(i).path === "") return;
    modal({
      title: `Permanently delete ${plural(sel.length, "item")}?`,
      sub: "They won't go to the Recycle Bin, and this can't be undone.",
      body: `<ul class="plist">${sel.slice(0, 6).map((e) => `<li>${icon(kind(e).icon)}${esc(e.name)}</li>`).join("")}${sel.length > 6 ? `<li class="more">and ${sel.length - 6} more</li>` : ""}</ul>`,
      ok: "Delete permanently",
      onOk: async () => {
        try { await FSX.deletePermanent(sel.map((e) => e.path)); } catch (e) { toast(err(e)); }
        pane(i).sel.clear(); await refresh([pane(i).path]);
        toast(`Permanently deleted ${plural(sel.length, "item")}`);
      },
    });
  }
  async function newFolder(i) {
    const p = pane(i);
    if (p.path === "") return;
    let path;
    try { path = await FSX.mkdir(p.path, "New folder"); } catch (e) { return toast(err(e)); }
    S.undo.push({ label: "new folder", undo: async () => { await FSX.trash([path]); await refresh([p.path]); } });
    await load(p.path, true);
    p.sel = new Set([path]); p.cursor = path; p.anchor = path;
    renderPane(i); renderChrome();
    startRename(i, path);
  }
  function startRename(i, path) {
    const r = rowEl(i, path); if (!r) return;
    const old = nameOf(path);
    const isDir = (rowsOf(i).find((e) => e.path === path) || {}).dir;
    r.classList.add("renaming"); r.draggable = false;
    const inp = el("input", "rename"); inp.value = old; inp.setAttribute("aria-label", "New name");
    r.querySelector(".nm").appendChild(inp);
    const dot = old.lastIndexOf(".");
    inp.focus(); inp.setSelectionRange(0, dot > 0 && !isDir ? dot : old.length);
    let done = false;
    const finish = async (commit) => {
      if (done) return; done = true;
      const v = inp.value.trim();
      if (commit && v && v !== old) {
        try {
          const np = await FSX.rename(path, v);
          S.undo.push({ label: "rename", undo: async () => { await FSX.rename(np, old); await refresh([parentOf(np)]); } });
          await load(parentOf(path), true);
          const p = pane(i); p.sel = new Set([np]); p.cursor = np; p.anchor = np;
        } catch (e) { toast(err(e)); }
      }
      renderPane(i); renderChrome(); focusList(i);
    };
    inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === "Enter") finish(true); if (e.key === "Escape") finish(false); };
    inp.onblur = () => finish(true);
  }
  function batchRename(i, sel) {
    const dir = pane(i).path;
    const draw = () => {
      const mode = $("#br-mode").value, a = $("#br-a").value, b = $("#br-b").value;
      const plan = sel.map((e, n) => {
        const d = e.name.lastIndexOf("."), stem = d > 0 && !e.dir ? e.name.slice(0, d) : e.name, x = d > 0 && !e.dir ? e.name.slice(d) : "";
        let to = e.name;
        if (mode === "replace") to = a ? e.name.split(a).join(b) : e.name;
        else if (mode === "pattern") to = (a || "{name}").replace(/\{name\}/g, stem).replace(/\{n+\}/g, (m) => String(n + (+b || 1)).padStart(m.length - 2, "0")) + x;
        else if (mode === "case") to = b === "upper" ? stem.toUpperCase() + x : b === "title" ? stem.replace(/\b\w/g, (c) => c.toUpperCase()) + x : stem.toLowerCase() + x;
        return { e, to };
      });
      const names = new Set(), dup = plan.some((x) => (names.has(x.to) ? true : (names.add(x.to), false)));
      $("#br-prev").innerHTML = plan.slice(0, 8).map((x) => `<li><span class="from">${esc(x.e.name)}</span>${icon("fwd")}<span class="${x.to === x.e.name ? "same" : ""}">${esc(x.to)}</span></li>`).join("") + (plan.length > 8 ? `<li class="more">and ${plan.length - 8} more</li>` : "");
      const changed = plan.filter((x) => x.to !== x.e.name).length;
      $("#dlg-ok").disabled = !changed || dup;
      $("#dlg-ok").textContent = dup ? "Two items would get the same name" : `Rename ${plural(changed, "item")}`;
      return plan;
    };
    modal({
      title: `Rename ${plural(sel.length, "item")}`,
      sub: "Preview updates as you type. You can undo this afterwards.",
      body: `<div class="form"><label>Method<select id="br-mode"><option value="pattern">Name and number</option><option value="replace">Find and replace</option><option value="case">Change case</option></select></label>
        <label id="br-al">Pattern<input id="br-a" value="${esc(nameOf(dir) || "File")} {nn}" spellcheck="false"></label><label id="br-bl">Start at<input id="br-b" value="1" spellcheck="false"></label></div>
        <p class="fine">Use {name} for the original name and {n}, {nn} or {nnn} for a padded number.</p><ul class="plist" id="br-prev"></ul>`,
      ok: "Rename",
      onOk: async () => {
        const plan = draw().filter((x) => x.to !== x.e.name);
        const done = [];
        for (const x of plan) { try { done.push({ np: await FSX.rename(x.e.path, x.to), old: x.e.name }); } catch (e) { toast(err(e)); break; } }
        S.undo.push({ label: "batch rename", undo: async () => { for (const d of done.reverse()) await FSX.rename(d.np, d.old).catch(() => {}); await refresh([dir]); } });
        pane(i).sel = new Set(done.map((d) => d.np));
        await refresh([dir]);
        toast(`Renamed ${plural(done.length, "item")}`, "Undo");
      },
      onOpen: () => {
        const setLabels = () => {
          const m = $("#br-mode").value;
          $("#br-al").firstChild.textContent = m === "replace" ? "Find" : m === "case" ? "Case" : "Pattern";
          $("#br-bl").firstChild.textContent = m === "replace" ? "Replace with" : m === "case" ? "Style (lower, upper, title)" : "Start at";
          if (m === "case") { $("#br-a").value = ""; $("#br-a").disabled = true; $("#br-b").value = "lower"; } else { $("#br-a").disabled = false; if (m === "replace") { $("#br-a").value = ""; $("#br-b").value = ""; } }
          draw();
        };
        $("#br-mode").onchange = setLabels;
        $("#br-a").oninput = draw; $("#br-b").oninput = draw;
        draw(); $("#br-a").focus(); $("#br-a").select();
      },
    });
  }
  async function calcSizes(i) {
    const folders = rowsOf(i).filter((e) => e.dir && !e.drive);
    if (!folders.length) return toast("No folders here to measure");
    toast(`Measuring ${plural(folders.length, "folder")}…`);
    await Promise.all(folders.map((f) => FSX.dirSize(f.path).then((d) => sizes.set(f.path, d.bytes)).catch(() => {})));
    pane(i).sort = { key: "size", dir: -1 };
    renderPane(i); renderChrome();
  }
  function findDupes(dir) {
    if (!dir) return toast("Open a drive or folder first");
    modal({ title: "Duplicate files", sub: `Looking in ${dir}…`, body: `<div class="plist busy">Comparing file contents. Large folders can take a minute.</div>`, ok: "Close", cancel: false, onOk: () => {} });
    FSX.duplicates(dir).then((groups) => {
      if ($("#dlg-scrim").hidden) return;
      const waste = groups.reduce((a, g) => a + g.size * (g.paths.length - 1), 0);
      $("#dlg-sub").textContent = groups.length ? `${plural(groups.length, "set")} of identical files in ${dir}. Removing the extra copies would free ${fmtSize(waste)}.` : `No duplicate files in ${dir}.`;
      $("#dlg-body").innerHTML = groups.length ? `<div class="dupes">${groups.slice(0, 80).map((g) => `<div class="grp"><div class="gh num">${plural(g.paths.length, "copy")} · ${fmtSize(g.size)} each</div>${g.paths.map((p) => `<button class="dp" data-p="${esc(p)}">${icon(kind({ name: p }).icon)}<span>${esc(p)}</span></button>`).join("")}</div>`).join("")}</div>` : "";
      $("#dlg-body").querySelectorAll(".dp").forEach((b) => (b.onclick = () => { closeScrim("#dlg-scrim"); reveal({ path: b.dataset.p, parent: parentOf(b.dataset.p), dir: false }); }));
    }).catch((e) => { $("#dlg-sub").textContent = err(e); $("#dlg-body").innerHTML = ""; });
  }
  async function undo() {
    const u = S.undo.pop();
    if (!u) return toast("Nothing to undo");
    try { await u.undo(); toast(`Undid ${u.label}`); } catch (e) { toast(`Couldn't undo ${u.label}: ${err(e)}`); }
  }

  /* ---------- transfers ---------- */
  function paste(i) {
    if (!S.clip) return;
    const dest = pane(i).path;
    if (!dest) return toast("Open a drive or folder to paste into");
    runTransfer(S.clip.mode === "cut" ? "move" : "copy", S.clip.paths, dest);
    if (S.clip.mode === "cut") S.clip = null;
  }
  function chooseDest(mode, sel) {
    const opts = [];
    const add = (path, label, ic) => { if (path && !opts.some((o) => o[0] === path)) opts.push([path, label, ic]); };
    if (S.layout === "dual") add(pane(S.pane === 0 ? 1 : 0).path, "Other pane", "swap");
    store.get("bookmarks", defaultMarks()).forEach(([l, p]) => add(p, l, "star"));
    FSX.drives().filter((d) => d.icon === "usb").forEach((d) => add(d.id, d.label, "usb"));
    ["Desktop", "Documents", "Downloads", "Pictures"].forEach((l) => { const pl = FSX.places().find((x) => x.label === l); if (pl) add(pl.path, l, pl.icon); });
    FSX.drives().filter((d) => d.icon !== "usb").forEach((d) => add(d.id, d.label, "drive"));
    let pick = opts.find(([p]) => !sel.some((e) => parentOf(e.path) === p)) || opts[0];
    let bytes = null; const free = new Map();
    const draw = () => {
      const dests = $("#dlg-body"); dests.innerHTML = "";
      opts.forEach((o) => {
        const [p, label, ic] = o;
        const f = free.get(driveOf(p));
        const sameDrive = mode === "move" && sel.every((e) => driveOf(e.path) === driveOf(p));
        const fits = sameDrive || (bytes != null && f != null && f >= bytes);
        const status = sameDrive ? "Instant, same drive" : bytes == null || f == null ? "Checking space…" : fits ? `Fits · ${fmtSize(f - bytes)} spare` : `Needs ${fmtSize(bytes - f)} more`;
        const b = el("button", "dest");
        b.setAttribute("role", "radio"); b.setAttribute("aria-checked", o === pick);
        b.innerHTML = `${icon(ic)}<span class="d">${esc(label)}<small>${esc(p)}</small></span><span class="fit num${fits || bytes == null || f == null ? "" : " no"}">${status}</span>`;
        b.onclick = () => { pick = o; draw(); };
        b.ondblclick = () => { pick = o; $("#dlg-ok").click(); };
        dests.appendChild(b);
      });
      const [p] = pick;
      const f = free.get(driveOf(p));
      const ok = (mode === "move" && sel.every((e) => driveOf(e.path) === driveOf(p))) || (bytes != null && f != null && f >= bytes);
      $("#dlg-ok").disabled = !ok;
      $("#dlg-sub").textContent = bytes == null ? "Measuring…" : `${fmtSize(bytes)} in total. Choose where ${sel.length === 1 ? "it goes" : "they go"}.`;
    };
    modal({
      title: `${mode === "move" ? "Move" : "Copy"} ${plural(sel.length, "item")}`,
      sub: "Measuring…", body: "", ok: `${mode === "move" ? "Move" : "Copy"} here`, bodyClass: "dests",
      onOk: () => runTransfer(mode, sel.map((e) => e.path), pick[0]),
      onOpen: () => { draw(); const c = $("#dlg-body [aria-checked=true]"); if (c) c.focus(); },
    });
    Promise.all(sel.map((e) => (e.dir ? folderBytes(e.path) : Promise.resolve(e.size || 0)))).then((b) => { bytes = b.reduce((a, x) => a + x, 0); if (!$("#dlg-scrim").hidden) draw(); });
    [...new Set(opts.map(([p]) => driveOf(p)))].forEach((d) => FSX.freeSpace(d || opts.find(([p]) => driveOf(p) === d)[0]).then((f) => { free.set(d, f); if (!$("#dlg-scrim").hidden) draw(); }));
  }
  async function runTransfer(mode, paths, dest) {
    if (S.xfer) return toast("Another transfer is running. Wait for it to finish, then try again.");
    let h;
    const start = performance.now();
    const label = `${mode === "move" ? "Moving" : "Copying"} ${plural(paths.length, "item")} to ${baseOf(dest)}${FSX.simulated ? " (simulated)" : ""}`;
    try {
      h = await FSX.transfer(mode, paths, dest, (p) => {
        if (!S.xfer) { S.xfer = h; $("#x-lbl").textContent = label; $("#xfer").classList.add("on"); renderStatus(); }
        const pct = p.total ? (p.done / p.total) * 100 : 0;
        $("#x-bar").style.width = pct.toFixed(1) + "%";
        const left = p.bytes_per_sec > 0 ? Math.ceil((p.total - p.done) / p.bytes_per_sec) : null;
        $("#x-info").textContent = p.state === "paused" ? `Paused · ${fmtSize(p.done)} of ${fmtSize(p.total)}`
          : `${fmtSize(p.done)} of ${fmtSize(p.total)}${p.bytes_per_sec ? ` · ${fmtSize(p.bytes_per_sec)}/s` : ""}${left != null ? ` · ${left < 60 ? left + " s" : Math.ceil(left / 60) + " min"} left` : ""}`;
      });
    } catch (e) { return toast(err(e)); }
    S.xfer = S.xfer || h;
    let paused = false;
    $("#x-pause").onclick = () => { paused = !paused; h.pause(paused); $("#x-pause").innerHTML = icon(paused ? "play" : "pause"); $("#x-pause").setAttribute("aria-label", paused ? "Resume transfer" : "Pause transfer"); };
    $("#x-cancel").onclick = () => h.cancel();
    const res = await h.done;
    S.xfer = null;
    $("#xfer").classList.remove("on");
    $("#x-pause").innerHTML = icon("pause");
    const touched = [dest, ...paths.map(parentOf)];
    await FSX.refreshDrives();
    await refresh([...touched, ...visiblePaths()]);
    if (res.state === "cancelled") return toast("Transfer cancelled. Nothing was left half-copied.");
    const secs = (performance.now() - start) / 1000;
    const moved = res.items || [];
    if (moved.length) {
      S.undo.push({
        label: mode,
        undo: async () => {
          if (mode === "copy") { await FSX.trash(moved.map((m) => m.to)); await refresh([dest]); return; }
          const byParent = new Map();
          moved.forEach((m) => { const pp = parentOf(m.from); byParent.set(pp, [...(byParent.get(pp) || []), m.to]); });
          for (const [pp, list] of byParent) { const hh = await FSX.transfer("move", list, pp, () => {}); await hh.done; }
          await refresh([dest, ...byParent.keys()]);
        },
      });
    }
    const speed = res.total && secs > 0.3 && !FSX.simulated ? ` in ${secs < 10 ? secs.toFixed(1) : Math.round(secs)} s (${fmtSize(res.total / secs)}/s)` : "";
    if (res.errors && res.errors.length) toast(`${mode === "move" ? "Moved" : "Copied"} with ${plural(res.errors.length, "problem")}: ${res.errors[0]}`);
    else toast(`${mode === "move" ? "Moved" : "Copied"} ${plural(moved.length, "item")} to ${baseOf(dest)}${speed}`, "Undo");
  }

  /* ---------- context menu ---------- */
  function showMenu(ev, items, run) {
    const m = $("#menu");
    m.innerHTML = items.map((it) => (it === "-" ? "<hr>" : `<button role="menuitem" data-act="${it[0]}"${it[4] ? " disabled" : ""}>${icon(it[2])}${it[1]}<kbd>${it[3]}</kbd></button>`)).join("");
    m.hidden = false;
    const w = m.offsetWidth, h = m.offsetHeight;
    m.style.left = Math.min(ev.clientX, innerWidth - w - 8) + "px";
    m.style.top = Math.min(ev.clientY, innerHeight - h - 8) + "px";
    m.querySelectorAll("[data-act]").forEach((b) => (b.onclick = () => { m.hidden = true; run(b.dataset.act); }));
    const first = m.querySelector("button:not([disabled])"); if (first) first.focus();
  }
  function onContext(ev, i) {
    ev.preventDefault();
    const r = ev.target.closest(".row");
    const p = pane(i);
    if (r && !p.sel.has(r.dataset.path)) { p.sel = new Set([r.dataset.path]); p.cursor = r.dataset.path; p.anchor = r.dataset.path; refreshSelection(i); }
    if (!r) { p.sel.clear(); refreshSelection(i); }
    const sel = selected(i);
    const one = sel.length === 1, dir = one && sel[0].dir;
    const items = sel.length
      ? [["open", "Open", "open", "Enter"], ...(dir ? [["newtab", "Open in new tab", "plus", ""], ["bookmark", "Add to bookmarks", "star", ""]] : []), "-",
        ["cut", "Cut", "cut", "Ctrl+X"], ["copy", "Copy", "copy", "Ctrl+C"], ["copyto", "Copy to…", "copy", ""], ["moveto", "Move to…", "move", ""], ["copypath", one ? "Copy path" : "Copy paths", "doc", ""], "-",
        ["rename", one ? "Rename" : "Rename all…", "rename", "F2"], ...(dir ? [["dupes", "Find duplicates inside", "copy", ""]] : []), "-",
        ["delete", "Delete", "trash", "Del"], ["delete-permanent", "Delete permanently…", "trash", "Shift+Del"]]
      : [["newfolder", "New folder", "newfolder", "Ctrl+Shift+N"], ["paste", "Paste", "paste", "Ctrl+V", !S.clip], "-",
        ["sizes", "Calculate folder sizes", "drive", ""], ["dupes", "Find duplicates here", "copy", ""], ["selectall", "Select all", "copy", "Ctrl+A"]];
    showMenu(ev, items, (a) => act(a, i));
  }
  document.addEventListener("mousedown", (e) => { if (!e.target.closest("#menu") && !e.target.closest("#viewbtn")) $("#menu").hidden = true; });

  /* ---------- command palette ---------- */
  let palSel = 0, palItems = [], palSeq = 0;
  const ACTIONS = [
    ["Single pane layout", () => setLayout("single"), "l-single", "Ctrl+1"], ["Two panes layout", () => setLayout("dual"), "l-dual", "Ctrl+2"],
    ["Layout with preview", () => setLayout("preview"), "l-prev", "Ctrl+3"], ["New tab", () => addTab(pane().path), "plus", "Ctrl+T"],
    ["New folder", () => act("newfolder"), "newfolder", "Ctrl+Shift+N"], ["Undo", () => undo(), "back", "Ctrl+Z"],
    ["Show or hide hidden files", () => toggleHidden(), "info", "Ctrl+H"], ["Calculate folder sizes", () => act("sizes"), "drive", ""],
    ["Find duplicate files in this folder", () => act("dupes"), "copy", ""], ["Rebuild the search index", () => { FSX.reindex(); toast("Rebuilding the search index in the background"); }, "search", ""],
    ["Settings", () => openSettings(), "gear", "Ctrl+,"],
    ...VIEWS.map(([v, l, ic], n) => [`View as ${l.toLowerCase()}`, () => setView(v), ic, `Ctrl+Shift+${n + 1}`]),
    ["Check for updates", () => FSX.checkUpdates(false), "download", ""],
    ["Turn automatic updates on or off", () => toggleAutoUpdate(), "download", ""],
    ["Make Slate the default file explorer", () => setDefault(true), "star", ""],
    [`Restore ${WIN ? "Windows Explorer" : "the previous file manager"} as default`, () => setDefault(false), "back", ""],
    ["Go to This PC", () => go(S.pane, ""), "pc", ""],
    ...FSX.places().map((pl) => [`Go to ${pl.label}`, () => go(S.pane, pl.path), pl.icon, ""]),
  ];
  async function openPalette() {
    openScrim("#pal-scrim");
    const inp = $("#pal-input"); inp.value = ""; inp.focus();
    searchPalette("");
    const st = await FSX.indexStatus().catch(() => null);
    if (st) $("#pal-idx").textContent = st.building ? `Indexing… ${st.count ? st.count.toLocaleString() + " so far" : ""}` : `${st.count.toLocaleString()} items indexed in ${st.build_ms < 1000 ? st.build_ms + " ms" : (st.build_ms / 1000).toFixed(1) + " s"}`;
  }
  async function searchPalette(q) {
    const seq = ++palSeq;
    const ql = q.trim().toLowerCase();
    const res = ql ? await FSX.search(q).catch(() => ({ hits: [], total: 0, ms: 0 })) : { hits: [], total: 0, ms: 0 };
    if (seq !== palSeq) return;
    const acts = ACTIONS.filter((a) => !ql || a[0].toLowerCase().includes(ql));
    palItems = [];
    const ul = $("#pal-list"); ul.innerHTML = "";
    const first = ql.split(/\s+/)[0] || "";
    const mark = (name) => { if (!first) return esc(name); const at = name.toLowerCase().indexOf(first); return at < 0 ? esc(name) : esc(name.slice(0, at)) + "<mark>" + esc(name.slice(at, at + first.length)) + "</mark>" + esc(name.slice(at + first.length)); };
    const addLi = (html) => {
      const li = el("li", "", html); li.setAttribute("role", "option");
      const n = palItems.length;
      li.onmousemove = () => { if (palSel !== n) { palSel = n; drawPalSel(); } };
      li.onclick = () => { palSel = n; runPal(); };
      ul.appendChild(li); return li;
    };
    if (res.hits.length) {
      ul.appendChild(el("li", "grp", "Files and folders"));
      res.hits.forEach((f) => palItems.push({ run: () => reveal(f), li: addLi(`${icon(f.dir ? "folder" : kind(f).icon, f.dir ? "i dir" : "i")}<span class="t">${mark(f.name)}</span><span class="w">${esc(f.parent)}</span>`) }));
    }
    if (acts.length) {
      ul.appendChild(el("li", "grp", "Actions"));
      acts.forEach((a) => palItems.push({ run: a[1], li: addLi(`${icon(a[2])}<span class="t">${mark(a[0])}</span><span class="w">${a[3]}</span>`) }));
    }
    if (!palItems.length) ul.appendChild(el("li", "grp", res.building ? "Still indexing. Results will appear as soon as your files are indexed." : `Nothing matches “${esc(q)}”. Check the spelling, or try another word from the name.`));
    $("#pal-count").textContent = ql ? `${res.total.toLocaleString()} match${res.total === 1 ? "" : "es"} · ${res.ms < 1 ? res.ms.toFixed(2) : res.ms.toFixed(1)} ms` : "";
    palSel = 0; drawPalSel();
  }
  function drawPalSel() { palItems.forEach((it, n) => { it.li.setAttribute("aria-selected", n === palSel); if (n === palSel) it.li.scrollIntoView({ block: "nearest" }); }); }
  function runPal() { const it = palItems[palSel]; if (!it) return; closeScrim("#pal-scrim"); it.run(); }
  async function reveal(f) {
    if (f.dir) return go(S.pane, f.path);
    await go(S.pane, f.parent);
    const p = pane();
    if (!(cache.get(p.path) || []).some((e) => e.path === f.path)) return toast(`${nameOf(f.path)} isn't there any more. The search index will catch up shortly.`);
    if (!showHidden && (cache.get(p.path) || []).find((e) => e.path === f.path).hidden) { showHidden = true; store.set("hidden", true); renderPane(S.pane); }
    p.sel = new Set([f.path]); p.cursor = f.path; p.anchor = f.path;
    refreshSelection(S.pane);
    const r = rowEl(S.pane, f.path); if (r) r.scrollIntoView({ block: "center" });
  }
  $("#pal-input").addEventListener("input", (e) => searchPalette(e.target.value));
  $("#pal-input").addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); palSel = Math.min(palItems.length - 1, palSel + 1); drawPalSel(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); palSel = Math.max(0, palSel - 1); drawPalSel(); }
    else if (e.key === "Enter") { e.preventDefault(); runPal(); }
  });
  async function toggleAutoUpdate() {
    const on = !(await FSX.autoUpdate());
    try { await FSX.setAutoUpdate(on); toast(on ? "Automatic updates are on. Slate updates itself when it starts." : "Automatic updates are off. Use Ctrl+K → Check for updates."); }
    catch (e) { toast(err(e)); }
  }
  // one live toast for the update flow
  let upToast = null;
  function updateToast(msg, action, onAction) {
    if (!upToast || !upToast.isConnected) { upToast = el("div", "toast"); $("#toasts").appendChild(upToast); }
    upToast.innerHTML = `<span class="num">${esc(msg)}</span>${action ? `<button class="btn">${esc(action)}</button>` : ""}`;
    if (action) upToast.querySelector("button").onclick = onAction;
  }
  function endUpdateToast(ms) { const t = upToast; upToast = null; if (t) setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 220); }, ms); }
  FSX.onUpdate((s) => {
    const v = s.version ? `v${s.version}` : "";
    if (s.state === "checking") updateToast("Checking for updates…");
    else if (s.state === "current") { updateToast(`Slate is up to date (${v})`); endUpdateToast(3000); }
    else if (s.state === "downloading") updateToast(`Updating Slate to ${v}… ${s.progress != null ? Math.round(s.progress * 100) + "%" : ""}. It restarts when done.`);
    else if (s.state === "installing") updateToast(`Installing Slate ${v}. Approve the admin prompt to finish.`);
    else if (s.state === "available") { updateToast(`Slate ${v} is available`, "Download", () => { FSX.open(s.message); endUpdateToast(0); }); endUpdateToast(12000); }
    else if (s.state === "error") { updateToast(s.message || "The update didn't work."); endUpdateToast(7000); }
  });
  function setDefault(enable, after = () => {}) {
    const what = WIN ? "Windows Explorer" : "your previous file manager";
    if (!enable) return FSX.setDefault(false).then(() => toast(`${what[0].toUpperCase() + what.slice(1)} is the default again`), (e) => toast(err(e))).then(after);
    modal({
      title: "Make Slate your default file explorer?",
      sub: WIN
        ? "Double-clicking folders and drives, and pressing Win+E, will open Slate. This only changes settings for your user account."
        : "Folders opened from your desktop and other apps will open in Slate instead of Dolphin.",
      body: `<p class="fine">You can switch back any time in Settings, or press Ctrl+K and choose “Restore ${WIN ? "Windows Explorer" : "the previous file manager"} as default”.</p>`,
      ok: "Make default",
      onOk: () => FSX.setDefault(true).then(() => toast("Slate is now your default file explorer"), (e) => toast(err(e))).then(after),
      onCancel: after,
    });
  }

  /* ---------- settings ---------- */
  const UNDO_PICKER = ["{DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7}", "{C0B4E2F3-BA21-4773-8DBA-335EC946EB8B}"]
    .flatMap((c) => [`reg delete "HKCU\\Software\\Classes\\CLSID\\${c}" /f`, `reg delete "HKCU\\Software\\Classes\\WOW6432Node\\CLSID\\${c}" /f`]).join("; ");
  function confirmPicker() {
    modal({
      wide: true,
      title: "Replace the Windows Open and Save dialogs?",
      sub: "This is experimental. Read this before you turn it on.",
      body: `<ul class="risks">
        <li>${icon("warn")}<span><b>Other apps could crash or fail to save.</b> Every app's Open and Save goes through Slate. A bug here affects all of them, possibly while you are saving your work.</span></li>
        <li>${icon("warn")}<span><b>Antivirus may flag or block it.</b> Norton, Defender and others watch this part of Windows closely, because malware uses it too.</span></li>
        <li>${icon("info")}<span>Apps running as administrator, Microsoft Store apps and some older apps keep the Windows dialog. So do apps that add their own options to it, like Notepad's encoding choice.</span></li>
        <li>${icon("info")}<span>Hold <kbd>Shift</kbd> while a dialog opens to get the Windows one. Turn this off here any time.</span></li>
      </ul>
      <p class="fine">If Slate ever stops opening, paste this into PowerShell to put the Windows dialogs back:</p>
      <div class="cmd"><code>${esc(UNDO_PICKER)}</code><button class="btn" id="copy-cmd">Copy</button></div>
      <label class="ack"><input type="checkbox" id="ack"><span>I understand the risks</span></label>`,
      ok: "Turn it on",
      onOk: async () => {
        try { await FSX.setPicker(true); toast("Other apps now open Slate for Open and Save. Hold Shift for the Windows dialog."); }
        catch (e) { toast(err(e)); }
        renderSettings();
      },
      onCancel: () => renderSettings(),
      onOpen: () => {
        $("#dlg-ok").disabled = true;
        $("#ack").onchange = () => { $("#dlg-ok").disabled = !$("#ack").checked; };
        $("#copy-cmd").onclick = () => navigator.clipboard.writeText(UNDO_PICKER).then(() => toast("Command copied"), () => toast("Couldn't copy to the clipboard"));
        $("#ack").focus();
      },
    });
  }
  async function openSettings() {
    if (PICK) return;
    openScrim("#set-scrim");
    await renderSettings();
    $("#set-close").focus();
  }
  async function renderSettings() {
    const [isDef, auto, picker, ver, idx] = await Promise.all([
      FSX.defaultStatus().catch(() => false), FSX.autoUpdate().catch(() => false), FSX.pickerEnabled().catch(() => false),
      FSX.version().catch(() => ""), FSX.indexStatus().catch(() => null),
    ]);
    const row = (title, desc, control, cls = "") => `<div class="srow${cls}"><div class="st"><b>${title}</b>${desc ? `<p>${desc}</p>` : ""}</div><div class="sc">${control}</div></div>`;
    const sw = (id, on, label, off = false) => `<button class="switch" role="switch" aria-checked="${!!on}" aria-label="${esc(label)}" data-set="${id}"${off ? " disabled" : ""}><i></i></button>`;
    const seg = (id, val, label, opts) => `<div class="sseg" role="radiogroup" aria-label="${esc(label)}" data-set="${id}">${opts.map(([v, l]) => `<button role="radio" aria-checked="${v === val}" data-v="${v}">${l}</button>`).join("")}</div>`;
    const sel = (id, val, label, opts) => `<select class="ssel" aria-label="${esc(label)}" data-set="${id}">${opts.map(([v, l]) => `<option value="${v}"${v === val ? " selected" : ""}>${l}</option>`).join("")}</select>`;
    const bin = WIN ? "Recycle Bin" : "Trash";
    let h = `<section><h3>General</h3>`;
    h += row("Default file explorer", WIN ? "Open folders, drives and Win+E in Slate instead of Windows Explorer." : "Open folders from your desktop and other apps in Slate.", sw("default", isDef, "Default file explorer", !FSX.real));
    if (WIN) h += row(`Use Slate for Open and Save dialogs <span class="tag">${icon("warn")}Experimental</span>`,
      `Browse, Open and Save buttons in other apps show Slate instead of the Windows dialog. <strong>This can make other apps crash or fail to save.</strong> Hold Shift as a dialog opens to get the Windows one.`,
      sw("picker", picker, "Use Slate for Open and Save dialogs", !FSX.real), picker ? " risky on" : " risky");
    h += row("Update automatically", "Install new versions when Slate starts.", sw("auto", auto, "Update automatically", !FSX.real));
    h += row("Version", ver ? `Slate ${esc(ver)}` : "", `<button class="btn" data-run="check">Check for updates</button>`);
    h += `</section><section><h3>Browsing</h3>`;
    h += row("When Slate opens", "", sel("startIn", pref("startIn"), "When Slate opens", [["last", "Reopen my last tabs"], ["home", "Home folder"], ["downloads", "Downloads"], ["thispc", "This PC"]]));
    h += row("Open items with", "", seg("singleClick", pref("singleClick") ? "1" : "0", "Open items with", [["0", "Double-click"], ["1", "Single click"]]));
    h += row("Show hidden files", "Also Ctrl+H.", sw("hidden", showHidden, "Show hidden files"));
    h += row("Show file extensions", "When off, extensions of common file types are hidden, as in Explorer.", sw("exts", pref("exts"), "Show file extensions"));
    h += row("Keep folders above files", "Whichever column you sort by.", sw("foldersFirst", pref("foldersFirst"), "Keep folders above files"));
    h += row(`Ask before moving to the ${bin}`, "Deleting can always be undone with Ctrl+Z.", sw("confirmTrash", pref("confirmTrash"), `Ask before moving to the ${bin}`));
    h += `</section><section><h3>Appearance</h3>`;
    if (WIN) h += row("File icons", "", seg("icons", pref("icons"), "File icons", [["system", "Windows icons"], ["slate", "Slate icons"]]));
    h += row("Row spacing", "", seg("density", pref("density"), "Row spacing", [["comfortable", "Comfortable"], ["compact", "Compact"]]));
    h += row("Dates", "", seg("dates", pref("dates"), "Dates", [["relative", "Today, Yesterday"], ["full", "Full date"]]));
    h += row("Animations", "", seg("motion", pref("motion"), "Animations", [["full", "On"], ["reduced", "Reduced"]]));
    h += `</section><section><h3>Search</h3>`;
    h += row("Search index", idx ? (idx.building ? `Indexing… ${idx.count.toLocaleString()} so far` : `${idx.count.toLocaleString()} items. Refreshes every 10 minutes.`) : "", `<button class="btn" data-run="reindex">Rebuild now</button>`);
    h += `</section><p class="set-foot">Press <kbd>Ctrl</kbd> <kbd>,</kbd> to open settings, or <kbd>Ctrl</kbd> <kbd>K</kbd> for every action.</p>`;
    const body = $("#set-body"), top = body.scrollTop;
    body.innerHTML = h;
    body.scrollTop = top;
    body.querySelectorAll(".switch").forEach((b) => (b.onclick = () => setSetting(b.dataset.set, b.getAttribute("aria-checked") !== "true", b)));
    body.querySelectorAll(".sseg").forEach((g) => g.querySelectorAll("button").forEach((b) => (b.onclick = () => setSetting(g.dataset.set, b.dataset.v, b))));
    body.querySelectorAll(".ssel").forEach((s) => (s.onchange = () => setSetting(s.dataset.set, s.value, s)));
    body.querySelectorAll("[data-run]").forEach((b) => (b.onclick = () => {
      if (b.dataset.run === "check") FSX.checkUpdates(false);
      else { FSX.reindex(); toast("Rebuilding the search index in the background"); setTimeout(renderSettings, 600); }
    }));
  }
  async function setSetting(id, v, from) {
    const refocus = () => { const b = $(`#set-body [data-set="${id}"]`); if (b) (b.matches(".sseg") ? b.querySelector('[aria-checked="true"]') : b).focus(); };
    if (id === "default") return setDefault(v, () => renderSettings().then(refocus));
    if (id === "picker") {
      if (v) return confirmPicker();
      try { await FSX.setPicker(false); toast("Other apps use the Windows Open and Save dialogs again"); } catch (e) { toast(err(e)); }
      return renderSettings().then(refocus);
    }
    if (id === "auto") { try { await FSX.setAutoUpdate(v); } catch (e) { toast(err(e)); } return renderSettings().then(refocus); }
    if (id === "hidden") { if (showHidden !== v) toggleHidden(); return renderSettings().then(refocus); }
    store.set("pref." + id, id === "singleClick" ? v === "1" : v);
    applyPrefs();
    visiblePanes().forEach((i) => renderPane(i));
    renderChrome();
    await renderSettings();
    refocus();
    void from;
  }

  /* ---------- picker bar (when this window is an Open / Save dialog) ---------- */
  const isAbs = (t) => (WIN ? /^[a-z]:([\\/]|$)/i.test(t) || t.startsWith("\\\\") : t.startsWith("/"));
  const nameList = (files) => (files.length === 1 ? files[0].name : files.map((f) => `"${f.name}"`).join(" "));
  async function resolveTyped(t) {
    t = t.replace(/^"|"$/g, "");
    let path = isAbs(t) ? (WIN ? t.replace(/\//g, "\\") : t) : child(pane().path, WIN ? t.replace(/\//g, "\\") : t);
    if (path.length > 3) path = path.replace(/[\\/]+$/, "");
    return { path, kind: await FSX.pathKind(path).catch(() => "none") };
  }
  function specExt() {
    const f = REQ.filters[pickType - 1];
    const m = f && /^\*\.([^*?;.]+)$/.exec(f.spec.split(";")[0].trim());
    return m ? m[1] : null;
  }
  // keep the name box in step with the selection, like the Windows dialog
  function p_sync(i) {
    if (!PICK || i !== S.pane) return;
    const sel = selected(i), inp = $("#pk-input");
    if (REQ.mode === "folder") { if (sel.length === 1 && sel[0].dir) inp.value = sel[0].name; }
    else { const files = sel.filter((e) => !e.dir); if (files.length) inp.value = REQ.mode === "save" ? files[0].name : nameList(files); }
  }
  async function pickFinish(paths) {
    const where = REQ.mode === "folder" ? paths[0] : parentOf(paths[0]);
    store.set("pickerLast", where);
    await FSX.pickerDone(PICK, paths, pickType);
  }
  const pickCancel = () => FSX.pickerDone(PICK, [], null);
  async function pickConfirm() {
    const p = pane(), sel = selected(), typed = $("#pk-input").value.trim();
    if (REQ.mode === "folder") {
      if (typed && !(sel.length === 1 && sel[0].name === typed)) {
        const r = await resolveTyped(typed);
        if (r.kind === "dir") return pickFinish([r.path]);
        return toast(`There's no folder called ${typed} here.`);
      }
      const target = sel.length === 1 && sel[0].dir ? sel[0].path : p.path;
      if (!target) return toast("Open or select a folder first.");
      return pickFinish([target]);
    }
    if (REQ.mode === "open") {
      const files = sel.filter((e) => !e.dir);
      if (files.length && (!typed || typed === nameList(files))) return pickFinish(REQ.multi ? files.map((e) => e.path) : [files[0].path]);
      if (!typed && sel.length === 1 && sel[0].dir) return go(S.pane, sel[0].path);
      if (!typed) return toast("Choose a file first.");
      const quoted = [...typed.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
      if (quoted.length > 1 && REQ.multi) {
        const rs = await Promise.all(quoted.map(resolveTyped));
        if (rs.every((r) => r.kind === "file")) return pickFinish(rs.map((r) => r.path));
        return toast(`Can't find ${quoted[rs.findIndex((r) => r.kind !== "file")]}.`);
      }
      const r = await resolveTyped(typed);
      if (r.kind === "dir") { $("#pk-input").value = ""; return go(S.pane, r.path); }
      if (r.kind === "file") return pickFinish([r.path]);
      return toast(`Can't find ${typed}. Check the name and try again.`);
    }
    // save
    if (!typed) { $("#pk-input").focus(); return toast("Type a name for the file."); }
    if (!p.path && !isAbs(typed)) return toast("Open a folder to save into.");
    let r = await resolveTyped(typed);
    if (r.kind === "dir") { $("#pk-input").value = ""; return go(S.pane, r.path); }
    if (/[<>:"|?*]/.test(nameOf(r.path))) return toast('File names can\'t contain < > : " | ? *');
    if (!ext(nameOf(r.path)) && REQ.default_ext != null) {
      const x = specExt() || REQ.default_ext.replace(/^\./, "");
      if (x) r = await resolveTyped(r.path + "." + x);
    }
    if (r.kind === "file" && REQ.overwrite_prompt) {
      return modal({ title: `Replace ${nameOf(r.path)}?`, sub: "A file with this name already exists here. Replacing it overwrites what's in it.", ok: "Replace", onOk: () => pickFinish([r.path]) });
    }
    pickFinish([r.path]);
  }
  function setupPicker() {
    const verb = REQ.ok_label || (REQ.mode === "save" ? "Save" : REQ.mode === "folder" ? "Select folder" : "Open");
    $("#pickbar").hidden = false;
    $("#status").hidden = true;
    $("#pk-ok").textContent = verb;
    $("#pk-label").textContent = REQ.mode === "folder" ? "Folder" : "File name";
    $("#pk-input").value = REQ.file_name || "";
    $("#pk-input").placeholder = REQ.mode === "save" ? "Name the file" : REQ.mode === "folder" ? "This folder, or type a folder name" : "Choose a file, or type its name";
    const verbTitle = REQ.title || (REQ.mode === "save" ? "Save as" : REQ.mode === "folder" ? "Choose a folder" : "Open");
    const t = el("div", "pk-title", `<b>${esc(verbTitle)}</b>${REQ.app ? `<span>for ${esc(REQ.app)}</span>` : ""}`);
    t.setAttribute("data-tauri-drag-region", "");
    $(".tabrow").insertBefore(t, $("#tabs"));
    document.title = `${verbTitle} · Slate`;
    if (REQ.filters.length && REQ.mode !== "folder") {
      const s = $("#pk-type");
      s.hidden = false;
      s.innerHTML = REQ.filters.map((f, n) => `<option value="${n + 1}">${esc(f.name)}${f.spec && !f.name.includes(f.spec) ? ` (${esc(f.spec)})` : ""}</option>`).join("");
      s.value = String(pickType);
      s.onchange = () => { pickType = +s.value; visiblePanes().forEach((i) => renderPane(i)); renderChrome(); };
    }
    $("#pk-ok").onclick = pickConfirm;
    $("#pk-cancel").onclick = pickCancel;
    $("#pk-input").onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); pickConfirm(); }
      if (e.key === "Escape") { e.preventDefault(); pickCancel(); }
    };
  }
  function toggleHidden() {
    showHidden = !showHidden; store.set("hidden", showHidden);
    visiblePanes().forEach((i) => renderPane(i)); renderChrome();
    toast(showHidden ? "Showing hidden files" : "Hiding hidden files");
  }

  /* ---------- overlays & toasts ---------- */
  let lastFocus = null;
  let dlgCancel = null;
  function openScrim(s) { if (s !== "#dlg-scrim" || $("#set-scrim").hidden) lastFocus = document.activeElement; $(s).hidden = false; }
  function closeScrim(s) {
    $(s).hidden = true;
    if (s === "#dlg-scrim" && dlgCancel) { const c = dlgCancel; dlgCancel = null; c(); }
    if (s === "#dlg-scrim" && !$("#set-scrim").hidden) return; // back to settings
    if (s === "#set-scrim") $("#fmenu").hidden = true;
    if (lastFocus && lastFocus.isConnected && lastFocus.offsetParent) lastFocus.focus(); else focusList(S.pane);
  }
  ["#pal-scrim", "#dlg-scrim", "#set-scrim"].forEach((s) => $(s).addEventListener("mousedown", (e) => { if (e.target === $(s)) closeScrim(s); }));
  function modal({ title, sub, body, ok, onOk, onOpen, onCancel, cancel = true, bodyClass = "", wide = false }) {
    $("#dlg-title").textContent = title;
    $("#dlg-sub").textContent = sub || "";
    $("#dlg-body").className = bodyClass;
    $("#dlg-body").innerHTML = body || "";
    $(".dialog").classList.toggle("wide", wide);
    $("#dlg-ok").textContent = ok; $("#dlg-ok").disabled = false;
    $("#dlg-cancel").hidden = !cancel;
    dlgCancel = onCancel || null;
    openScrim("#dlg-scrim");
    $("#dlg-ok").onclick = () => { if ($("#dlg-ok").disabled) return; dlgCancel = null; closeScrim("#dlg-scrim"); onOk && onOk(); };
    $("#dlg-cancel").onclick = () => closeScrim("#dlg-scrim");
    if (onOpen) onOpen(); else $("#dlg-ok").focus();
  }
  function toast(msg, action) {
    const t = el("div", "toast", `<span>${esc(msg)}</span>${action ? `<button class="btn">${action}</button>` : ""}`);
    $("#toasts").appendChild(t);
    const kill = () => { t.classList.add("out"); setTimeout(() => t.remove(), 220); };
    if (action) t.querySelector("button").onclick = () => { kill(); undo(); };
    setTimeout(kill, action ? 6000 : 3600);
    while ($("#toasts").children.length > 3) $("#toasts").firstChild.remove();
  }

  /* ---------- keyboard ---------- */
  document.addEventListener("keydown", (e) => {
    const ctrl = e.ctrlKey || e.metaKey, k = e.key;
    const overlay = ["#dlg-scrim", "#pal-scrim", "#set-scrim"].find((s) => !$(s).hidden);
    if (overlay) {
      if (k === "Escape") { e.preventDefault(); closeScrim(overlay); }
      if (k === "Enter" && overlay === "#dlg-scrim" && e.target.matches("input:not([type=checkbox])")) { e.preventDefault(); $("#dlg-ok").click(); }
      return;
    }
    if (!$("#fmenu").hidden) {
      if (k === "Escape") { e.preventDefault(); $("#fmenu").hidden = true; focusList(S.pane); }
      if (k === "ArrowDown" || k === "ArrowUp") {
        e.preventDefault();
        const bs = [...$("#fmenu").querySelectorAll("button:not([disabled])")], at = bs.indexOf(document.activeElement);
        bs[(at + (k === "ArrowDown" ? 1 : bs.length - 1)) % bs.length].focus();
      }
      return;
    }
    if (ctrl && k === ",") { e.preventDefault(); return openSettings(); }
    if (!$("#menu").hidden) {
      if (k === "Escape") $("#menu").hidden = true;
      if (k === "ArrowDown" || k === "ArrowUp") {
        e.preventDefault();
        const bs = [...$("#menu").querySelectorAll("button:not([disabled])")], at = bs.indexOf(document.activeElement);
        bs[(at + (k === "ArrowDown" ? 1 : bs.length - 1)) % bs.length].focus();
      }
      return;
    }
    if (e.target.matches("input, select")) return;
    if (ctrl && (k === "k" || k === "f" || k === "e")) { e.preventDefault(); return openPalette(); }
    if (ctrl && k === "l") { e.preventDefault(); return editPath(); }
    if (ctrl && k === "t") { e.preventDefault(); return addTab(pane().path); }
    if (ctrl && k === "w") { e.preventDefault(); return closeTab(S.tab); }
    if (ctrl && k === "h") { e.preventDefault(); return toggleHidden(); }
    if (ctrl && k === "Tab") { e.preventDefault(); return selectTab((S.tab + (e.shiftKey ? S.tabs.length - 1 : 1)) % S.tabs.length); }
    if (ctrl && e.shiftKey && /^Digit[1-4]$/.test(e.code)) { e.preventDefault(); return setView(VIEWS[+e.code.slice(5) - 1][0]); }
    if (ctrl && ["1", "2", "3"].includes(k)) { e.preventDefault(); return setLayout(["single", "dual", "preview"][+k - 1]); }
    if (e.altKey && k === "ArrowLeft") { e.preventDefault(); return back(); }
    if (e.altKey && k === "ArrowRight") { e.preventDefault(); return fwd(); }
    if (e.altKey && k === "ArrowUp") { e.preventDefault(); return up(); }
    if (ctrl && e.shiftKey && (k === "N" || k === "n")) { e.preventDefault(); return act("newfolder"); }
    if (ctrl && k === "z") { e.preventDefault(); return undo(); }
    if (k === "F5") { e.preventDefault(); return refresh(visiblePaths()); }
    const inList = e.target.closest && e.target.closest(".list");
    if (!inList && e.target !== document.body) return;
    const p = pane(), list = rowsOf(S.pane).map((x) => x.path);
    const move = (to) => {
      if (!list.length) return;
      to = Math.max(0, Math.min(list.length - 1, to));
      const path = list[to];
      if (e.shiftKey && p.anchor) { const a = list.indexOf(p.anchor); p.sel = new Set(list.slice(Math.min(a, to), Math.max(a, to) + 1)); }
      else if (!ctrl) { p.sel = new Set([path]); p.anchor = path; }
      p.cursor = path; refreshSelection(S.pane);
      const r = rowEl(S.pane, path); if (r) r.scrollIntoView({ block: "nearest" });
    };
    const ci = p.cursor ? list.indexOf(p.cursor) : -1;
    const cols = pref("view") === "details" ? 1 : gridCols(S.pane);
    switch (true) {
      case k === "ArrowDown": e.preventDefault(); move(ci < 0 ? 0 : ci + cols); break;
      case k === "ArrowUp": e.preventDefault(); move(ci < 0 ? 0 : ci - cols); break;
      case k === "ArrowRight" && cols > 1: e.preventDefault(); move(ci + 1); break;
      case k === "ArrowLeft" && cols > 1: e.preventDefault(); move(ci < 0 ? 0 : ci - 1); break;
      case k === "Home": e.preventDefault(); move(0); break;
      case k === "End": e.preventDefault(); move(list.length - 1); break;
      case k === "PageDown": e.preventDefault(); move(ci + 12); break;
      case k === "PageUp": e.preventDefault(); move(ci - 12); break;
      case k === " " && ctrl && !!p.cursor: e.preventDefault(); p.sel.has(p.cursor) ? p.sel.delete(p.cursor) : p.sel.add(p.cursor); refreshSelection(S.pane); break;
      case k === "Enter": e.preventDefault(); if (p.cursor) open(S.pane, p.cursor); break;
      case k === "Backspace": e.preventDefault(); up(); break;
      case k === "Delete": e.preventDefault(); e.shiftKey ? act("delete-permanent") : act("delete"); break;
      case k === "F2": e.preventDefault(); act("rename"); break;
      case ctrl && k === "a": e.preventDefault(); act("selectall"); break;
      case ctrl && k === "c": e.preventDefault(); act("copy"); break;
      case ctrl && k === "x": e.preventDefault(); act("cut"); break;
      case ctrl && k === "v": e.preventDefault(); act("paste"); break;
      case k === "Tab" && S.layout === "dual": e.preventDefault(); S.pane = S.pane ? 0 : 1; markFocus(); focusList(S.pane); renderChrome(); break;
      case k === "Escape": if (PICK && !p.sel.size) { pickCancel(); break; } p.sel.clear(); refreshSelection(S.pane); break;
      case k.length === 1 && !ctrl && !e.altKey: {
        const now = Date.now();
        p._typed = now - (p._typedAt || 0) < 700 ? (p._typed || "") + k.toLowerCase() : k.toLowerCase();
        p._typedAt = now;
        const hit = rowsOf(S.pane).findIndex((x) => x.name.toLowerCase().startsWith(p._typed));
        if (hit >= 0) move(hit);
      }
    }
  });

  /* ---------- splitters ---------- */
  document.querySelectorAll(".splitter").forEach((sp) => {
    sp.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      sp.setPointerCapture(e.pointerId);
      sp.classList.add("active");
      const which = sp.dataset.split, x0 = e.clientX, v0 = S[which];
      const onMove = (ev) => {
        const dx = ev.clientX - x0;
        S[which] = which === "side" ? Math.max(180, Math.min(420, v0 + dx)) : Math.max(260, Math.min(560, v0 - dx));
        applyLayout();
      };
      const onUp = () => {
        sp.classList.remove("active");
        store.set(which, S[which]);
        sp.removeEventListener("pointermove", onMove); sp.removeEventListener("pointerup", onUp);
      };
      sp.addEventListener("pointermove", onMove); sp.addEventListener("pointerup", onUp);
    });
    sp.addEventListener("dblclick", () => { S[sp.dataset.split] = sp.dataset.split === "side" ? 236 : 340; store.set(sp.dataset.split, S[sp.dataset.split]); applyLayout(); });
  });
  const ro = new ResizeObserver((ents) => ents.forEach((en) => {
    const w = en.contentRect.width;
    en.target.classList.toggle("narrow", w < 440);
    en.target.classList.toggle("mid", w >= 440 && w < 720);
  }));
  ro.observe($("#pane-a")); ro.observe($("#pane-b"));

  /* ---------- window ---------- */
  const W = FSX.window;
  $("#w-min").onclick = () => W && W.minimize();
  $("#w-max").onclick = () => W && W.toggleMaximize();
  $("#w-close").onclick = () => (PICK ? pickCancel() : W && W.close());
  $(".tabrow").addEventListener("dblclick", (e) => { if (W && (e.target.matches(".drag") || e.target === $(".tabrow"))) W.toggleMaximize(); });
  if (W && FSX.platform !== "windows") {
    // undecorated windows on Linux need their own resize edges
    const dirs = { n: "North", s: "South", e: "East", w: "West", ne: "NorthEast", nw: "NorthWest", se: "SouthEast", sw: "SouthWest" };
    Object.keys(dirs).forEach((d) => {
      const h = el("div", `rz rz-${d}`);
      h.addEventListener("mousedown", (e) => { if (e.button === 0) { e.preventDefault(); W.startResizeDragging(dirs[d]); } });
      document.body.appendChild(h);
    });
  }
  if (!W) { $(".winctl").hidden = true; }

  /* ---------- wiring ---------- */
  $("#back").onclick = back; $("#fwd").onclick = fwd; $("#up").onclick = up;
  $("#newtab").onclick = () => addTab(pane().path);
  $("#search").onclick = openPalette;
  $("#gear").onclick = openSettings;
  $("#viewbtn").onclick = (e) => { e.stopPropagation(); if (!$("#menu").hidden) { $("#menu").hidden = true; return; } showViewMenu(); };
  syncViewButton();
  $("#set-close").onclick = () => closeScrim("#set-scrim");
  document.querySelectorAll(".seg button").forEach((b) => (b.onclick = () => setLayout(b.dataset.layout)));
  document.addEventListener("mouseup", (e) => { if (e.button === 3) back(); if (e.button === 4) fwd(); });
  document.addEventListener("keydown", () => document.body.classList.add("kbd"), true);
  document.addEventListener("mousedown", () => document.body.classList.remove("kbd"), true);
  // keep views in sync with changes made outside Slate
  window.addEventListener("focus", () => refresh(visiblePaths()));
  setInterval(() => { if (!document.hidden && !S.xfer && !document.querySelector(".rename")) refresh(visiblePaths()); }, 4000);
  setInterval(() => { if (!document.hidden) FSX.refreshDrives().then(() => renderSide()); }, 30000);

  /* ---------- start ---------- */
  // opened on a folder (Explorer's "Open in Slate", a file manager handler, Win+E)
  const startAt = PICK ? null : await FSX.startupPath().catch(() => null);
  if (startAt) { S.tabs.push(newTab(startAt, HOME)); S.tab = S.tabs.length - 1; }
  if (!PICK) FSX.onOpenPath((path) => addTab(path || HOME));
  if (PICK) setupPicker();
  applyLayout();
  await Promise.all([0, 1].map((i) => load(pane(i).path).catch(() => { pane(i).path = HOME; return load(HOME); })));
  if (!FSX.real) {
    const p = pane(0), iso = p.path + "\\Fedora-KDE-Live-x86_64-45.iso";
    if ((cache.get(p.path) || []).some((e) => e.path === iso)) { p.sel = new Set([iso]); p.cursor = p.anchor = iso; }
  }
  visiblePanes().forEach((i) => renderPane(i, true));
  if (S.layout !== "dual") renderPane(1);
  renderChrome();
  if (PICK && REQ.mode === "save") { const inp = $("#pk-input"); inp.focus(); const d = inp.value.lastIndexOf("."); inp.setSelectionRange(0, d > 0 ? d : inp.value.length); }
  else focusList(0);
  // update on launch (quietly: only says something if there is an update)
  if (!PICK && await FSX.autoUpdate().catch(() => false)) FSX.checkUpdates(true);
})();
