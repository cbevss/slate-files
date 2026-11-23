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
  const newPane = (path) => ({ path, back: [], fwd: [], sel: new Set(), cursor: null, anchor: null, sort: { key: "name", dir: 1 } });
  const newTab = (path, pathB) => ({ id: ++uid, panes: [newPane(path), newPane(pathB || path)] });
  const firstPlace = (label) => (FSX.places().find((p) => p.label === label) || {}).path;
  const savedTabs = store.get("tabs", null);
  const S = {
    tabs: (savedTabs && savedTabs.length ? savedTabs : [firstPlace("Downloads") || HOME]).map((p) => newTab(p, FSX.real ? HOME : "E:\\Backups")),
    tab: 0,
    pane: 0,
    layout: store.get("layout", "preview"),
    side: store.get("side", 236),
    prev: store.get("prev", 340),
    clip: null,
    undo: [],
    xfer: null,
  };
  const tab = () => S.tabs[S.tab];
  const pane = (i = S.pane) => tab().panes[i];
  const visiblePanes = () => (S.layout === "dual" ? [0, 1] : [0]);
  const saveTabs = () => store.set("tabs", S.tabs.map((t) => t.panes[0].path));

  function entries(p) {
    const list = (cache.get(p.path) || []).filter((e) => showHidden || !e.hidden);
    const { key, dir } = p.sort;
    const val = (e) => key === "size" ? (e.dir ? sizes.get(e.path) ?? -1 : e.size) : key === "mtime" ? e.mtime || 0 : key === "type" ? kind(e).label : e.name.toLowerCase();
    return list.slice().sort((a, b) => {
      if (a.dir !== b.dir) return a.dir ? -1 : 1;
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
  const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
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
    S.layout = l; store.set("layout", l);
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
    h += `<div class="cols">${COLS.map(([k, label, cls]) => `<div class="${cls}"><button data-sort="${k}"${p.sort.key === k ? ` aria-sort="${p.sort.dir > 0 ? "ascending" : "descending"}"` : ""}>${label}${p.sort.key === k ? icon("sort") : ""}</button></div>`).join("")}</div>`;
    h += `<div class="list" tabindex="0" role="listbox" aria-multiselectable="true" aria-label="${esc(baseOf(p.path))}">`;
    if (!list.length) h += `<div class="empty"><div><b>This folder is empty</b>Drop files here, or press Ctrl+Shift+N to make a new folder.</div></div>`;
    // render in one string; rows beyond the first screen skip the entrance animation
    const rows = [];
    for (let n = 0; n < list.length; n++) {
      const e = list[n], k = kind(e);
      const sel = p.sel.has(e.path);
      const cut = S.clip && S.clip.mode === "cut" && S.clip.paths.includes(e.path);
      const sz = e.drive ? `${fmtSize(e.drive.free)} free` : e.dir ? (sizes.has(e.path) ? fmtSize(sizes.get(e.path)) : e.items != null ? plural(e.items, "item") : "") : fmtSize(e.size);
      const anim = animateRows && n < 24;
      rows.push(`<div class="row${anim ? " enter" : ""}${p.cursor === e.path ? " cursor" : ""}${cut ? " cut" : ""}${e.hidden ? " hid" : ""}" role="option" aria-selected="${sel}" draggable="true" data-path="${esc(e.path)}"${anim ? ` style="animation-delay:${n * 12}ms"` : ""}><div class="nm">${icon(k.icon, e.dir ? "i dir" : "i")}<span>${esc(e.name)}</span></div><span class="sub c-mod num">${fmtDate(e.mtime)}</span><span class="sub c-type">${k.label}</span><span class="sub r num">${sz}</span></div>`);
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
    lst.addEventListener("mousedown", (ev) => onRowDown(ev, i));
    lst.addEventListener("dblclick", (ev) => { const r = ev.target.closest(".row"); if (r) open(i, r.dataset.path); });
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
    p.path = path; p.sel.clear(); p.anchor = null; p.cursor = null;
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
      box.innerHTML = `<div class="art">${icon(k.icon)}${e.dir || e.drive ? "" : `<span class="ext">${esc(ext(e.name).toUpperCase())}</span>`}</div>
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
    const hidden = (cache.get(pane().path) || []).length - list.length;
    $("#st-count").textContent = plural(list.length, "item") + (hidden > 0 ? ` (${hidden} hidden)` : "");
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

  async function del(i, sel) {
    if (!sel.length || pane(i).path === "") return;
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
  document.addEventListener("mousedown", (e) => { if (!e.target.closest("#menu")) $("#menu").hidden = true; });

  /* ---------- command palette ---------- */
  let palSel = 0, palItems = [], palSeq = 0;
  const ACTIONS = [
    ["Single pane layout", () => setLayout("single"), "l-single", "Ctrl+1"], ["Two panes layout", () => setLayout("dual"), "l-dual", "Ctrl+2"],
    ["Layout with preview", () => setLayout("preview"), "l-prev", "Ctrl+3"], ["New tab", () => addTab(pane().path), "plus", "Ctrl+T"],
    ["New folder", () => act("newfolder"), "newfolder", "Ctrl+Shift+N"], ["Undo", () => undo(), "back", "Ctrl+Z"],
    ["Show or hide hidden files", () => toggleHidden(), "info", "Ctrl+H"], ["Calculate folder sizes", () => act("sizes"), "drive", ""],
    ["Find duplicate files in this folder", () => act("dupes"), "copy", ""], ["Rebuild the search index", () => { FSX.reindex(); toast("Rebuilding the search index in the background"); }, "search", ""],
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
  function toggleHidden() {
    showHidden = !showHidden; store.set("hidden", showHidden);
    visiblePanes().forEach((i) => renderPane(i)); renderChrome();
    toast(showHidden ? "Showing hidden files" : "Hiding hidden files");
  }

  /* ---------- overlays & toasts ---------- */
  let lastFocus = null;
  function openScrim(s) { lastFocus = document.activeElement; $(s).hidden = false; }
  function closeScrim(s) { $(s).hidden = true; if (lastFocus && lastFocus.isConnected) lastFocus.focus(); else focusList(S.pane); }
  ["#pal-scrim", "#dlg-scrim"].forEach((s) => $(s).addEventListener("mousedown", (e) => { if (e.target === $(s)) closeScrim(s); }));
  function modal({ title, sub, body, ok, onOk, onOpen, cancel = true, bodyClass = "" }) {
    $("#dlg-title").textContent = title;
    $("#dlg-sub").textContent = sub || "";
    $("#dlg-body").className = bodyClass;
    $("#dlg-body").innerHTML = body || "";
    $("#dlg-ok").textContent = ok; $("#dlg-ok").disabled = false;
    $("#dlg-cancel").hidden = !cancel;
    openScrim("#dlg-scrim");
    $("#dlg-ok").onclick = () => { if ($("#dlg-ok").disabled) return; closeScrim("#dlg-scrim"); onOk && onOk(); };
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
    if (!$("#pal-scrim").hidden || !$("#dlg-scrim").hidden) {
      if (k === "Escape") { e.preventDefault(); closeScrim(!$("#pal-scrim").hidden ? "#pal-scrim" : "#dlg-scrim"); }
      if (k === "Enter" && !$("#dlg-scrim").hidden && e.target.matches("input")) { e.preventDefault(); $("#dlg-ok").click(); }
      return;
    }
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
    switch (true) {
      case k === "ArrowDown": e.preventDefault(); move(ci + 1); break;
      case k === "ArrowUp": e.preventDefault(); move(ci < 0 ? 0 : ci - 1); break;
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
      case k === "Escape": p.sel.clear(); refreshSelection(S.pane); break;
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
  $("#w-close").onclick = () => W && W.close();
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
  document.querySelectorAll(".seg button").forEach((b) => (b.onclick = () => setLayout(b.dataset.layout)));
  document.addEventListener("mouseup", (e) => { if (e.button === 3) back(); if (e.button === 4) fwd(); });
  document.addEventListener("keydown", () => document.body.classList.add("kbd"), true);
  document.addEventListener("mousedown", () => document.body.classList.remove("kbd"), true);
  // keep views in sync with changes made outside Slate
  window.addEventListener("focus", () => refresh(visiblePaths()));
  setInterval(() => { if (!document.hidden && !S.xfer && !document.querySelector(".rename")) refresh(visiblePaths()); }, 4000);
  setInterval(() => { if (!document.hidden) FSX.refreshDrives().then(() => renderSide()); }, 30000);

  /* ---------- start ---------- */
  applyLayout();
  await Promise.all([0, 1].map((i) => load(pane(i).path).catch(() => { pane(i).path = HOME; return load(HOME); })));
  if (!FSX.real) {
    const p = pane(0), iso = p.path + "\\Fedora-KDE-Live-x86_64-45.iso";
    if ((cache.get(p.path) || []).some((e) => e.path === iso)) { p.sel = new Set([iso]); p.cursor = p.anchor = iso; }
  }
  visiblePanes().forEach((i) => renderPane(i, true));
  if (S.layout !== "dual") renderPane(1);
  renderChrome();
  focusList(0);
})();
