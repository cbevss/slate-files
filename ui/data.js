// Sample filesystem for the UI prototype. Synthetic data, not the user's files.
// The real app replaces window.FS with calls into the Rust backend (same shape).
(function () {
  const now = Date.now();
  const H = 3600e3, D = 24 * H;
  const KB = 1024, MB = KB * 1024, GB = MB * 1024;
  const t = (daysAgo, hh = 12, mm = 0) => {
    const d = new Date(now - daysAgo * D);
    d.setHours(hh, mm, 0, 0);
    return d.getTime();
  };
  const dir = (name, mtime, children = []) => ({ name, dir: true, mtime, children });
  const f = (name, size, mtime) => ({ name, dir: false, size, mtime });
  const many = (prefix, ext, n, size, startDay) =>
    Array.from({ length: n }, (_, i) => f(`${prefix}${String(4800 + i).padStart(4, "0")}.${ext}`, size * (0.6 + ((i * 37) % 80) / 100), t(startDay + i * 0.4, 10 + (i % 9), (i * 7) % 60)));

  const downloads = dir("Downloads", t(0, 9, 12), [
    dir("Camera Roll", t(1, 18, 40), many("IMG_", "HEIC", 212, 3.1 * MB, 1)),
    dir("tax-2025", t(11, 10, 2), [
      f("bank-statement-oct.pdf", 188 * KB, t(20, 9, 0)), f("insurance-renewal.pdf", 1.4 * MB, t(26)),
      f("p60-2025.pdf", 92 * KB, t(233)), f("payslip-2026-10.pdf", 74 * KB, t(23)), f("receipt-laptop.pdf", 310 * KB, t(158)),
    ]),
    dir("wallpapers", t(51, 14, 0), many("wall-", "png", 64, 9.4 * MB, 51)),
    f("Fedora-KDE-Live-x86_64-45.iso", 2.41 * GB, t(0, 9, 12)),
    f("project-archive-2026.zip", 1.08 * GB, t(0, 8, 55)),
    f("invoice-10422.pdf", 212 * KB, t(0, 8, 31)),
    f("Q3-budget.xlsx", 84 * KB, t(1, 16, 2)),
    f("screen-recording-2026-11-22.mp4", 412 * MB, t(1, 11, 47)),
    f("IMG_4821.HEIC", 3.2 * MB, t(2, 14, 20)),
    f("setup-vscode-x64.exe", 98.4 * MB, t(3, 9, 0)),
    f("notes.md", 4 * KB, t(4, 21, 15)),
    f("boarding-pass-LHR.pdf", 96 * KB, t(6, 6, 10)),
    f("font-pack.7z", 31.7 * MB, t(9, 12, 44)),
    f("meeting-2026-11-12.m4a", 18.9 * MB, t(11, 15, 30)),
    f("resume-final-v3.docx", 41 * KB, t(14, 19, 5)),
    f("drivers-gpu-566.14.exe", 812 * MB, t(21, 22, 10)),
    f("scan-0042.png", 5.6 * MB, t(26, 11, 11)),
    f("playlist-export.csv", 12 * KB, t(33, 17, 48)),
    f("keys-backup.txt", 1 * KB, t(52, 8, 0)),
    f("invoice-10398.pdf", 208 * KB, t(21, 10, 0)),
    f("manual-router-ax3000.pdf", 6.1 * MB, t(72)),
    f("rental-agreement-2026.pdf", 2.2 * MB, t(295)),
    f("tickets-concert-dec.pdf", 140 * KB, t(9)),
    f("train-booking-0412.pdf", 88 * KB, t(15)),
  ]);

  const projects = dir("Projects", t(0, 7, 40), [
    dir("file-explorer", t(0, 7, 40), [
      dir("src", t(0, 7, 40), [f("main.rs", 18 * KB, t(0, 7, 40)), f("index.rs", 42 * KB, t(0, 7, 12)), f("copy.rs", 27 * KB, t(1))]),
      dir("ui", t(0, 7, 30), [f("index.html", 9 * KB, t(0)), f("styles.css", 21 * KB, t(0)), f("app.js", 48 * KB, t(0))]),
      f("Cargo.toml", 2 * KB, t(2)), f("README.md", 6 * KB, t(2)), f("LICENSE", 1 * KB, t(40)),
    ]),
    dir("website", t(18), [f("index.html", 12 * KB, t(18)), f("styles.css", 8 * KB, t(18))]),
    f("ideas.md", 3 * KB, t(5)),
  ]);

  const tree = {
    "C:": dir("Windows (C:)", t(0), [
      dir("Program Files", t(30), []),
      dir("Users", t(90), [
        dir("alex", t(0), [
          dir("Desktop", t(2), [f("todo.txt", 2 * KB, t(2)), f("screenshot-2026-11-21.png", 1.8 * MB, t(2))]),
          dir("Documents", t(3), [
            dir("Invoices 2026", t(0), [f("invoice-10422.pdf", 212 * KB, t(0)), f("invoice-10398.pdf", 208 * KB, t(21))]),
            f("cv.docx", 38 * KB, t(30)), f("budget-2027.xlsx", 66 * KB, t(3)),
          ]),
          downloads,
          dir("Music", t(60), [f("demo-mix.flac", 41 * MB, t(60))]),
          dir("Pictures", t(1), [dir("2026", t(1), many("DSC_", "jpg", 48, 6.2 * MB, 1))]),
          projects,
        ]),
      ]),
      dir("Windows", t(4), []),
    ]),
    "D:": dir("Data (D:)", t(1), [dir("Photos", t(1), [dir("2026", t(1), many("DSC_", "jpg", 120, 6.4 * MB, 1))]), dir("Backups", t(40), [])]),
    "E:": dir("USB Stick (E:)", t(30), [
      dir("Backups", t(30), [dir("2025", t(325), []), dir("phone-backup", t(24), []), f("installer-cache.zip", 2.1 * GB, t(72)), f("README.txt", 1 * KB, t(326))]),
    ]),
  };

  const drives = [
    { id: "C:", label: "Windows (C:)", icon: "drive", total: 512 * GB, free: 212 * GB },
    { id: "D:", label: "Data (D:)", icon: "drive", total: 2000 * GB, free: 1300 * GB },
    { id: "E:", label: "USB Stick (E:)", icon: "usb", total: 32 * GB, free: 22 * GB },
  ];

  function node(path) {
    if (!path) return null;
    const parts = path.split("\\").filter(Boolean);
    let cur = tree[parts[0]];
    for (let i = 1; i < parts.length && cur; i++) cur = (cur.children || []).find((c) => c.dir && c.name === parts[i]);
    return cur || null;
  }

  function size(n) {
    if (!n.dir) return n.size;
    return (n.children || []).reduce((a, c) => a + size(c), 0);
  }

  function walk(visit) {
    for (const id of Object.keys(tree)) {
      const rec = (n, p) => {
        for (const c of n.children || []) {
          const cp = p + "\\" + c.name;
          visit(c, cp, p);
          if (c.dir) rec(c, cp);
        }
      };
      rec(tree[id], id);
    }
  }

  window.FS = {
    home: "C:\\Users\\alex",
    drives: () => drives,
    exists: (p) => p === "" || !!node(p),
    list(p) {
      if (p === "") return drives.map((d) => ({ name: d.label, dir: true, drive: d, path: d.id, mtime: null }));
      const n = node(p);
      return n ? n.children.map((c) => ({ ...c, path: p + "\\" + c.name, items: c.dir ? c.children.length : undefined })) : null;
    },
    size: (p) => { const n = node(p); return n ? size(n) : 0; },
    walk,
    remove(p) {
      const parent = node(p.slice(0, p.lastIndexOf("\\")));
      const name = p.slice(p.lastIndexOf("\\") + 1);
      const i = parent ? parent.children.findIndex((c) => c.name === name) : -1;
      return i >= 0 ? parent.children.splice(i, 1)[0] : null;
    },
    insert(dirPath, entry) { const n = node(dirPath); if (n) n.children.push(entry); },
    rename(p, newName) {
      const parent = node(p.slice(0, p.lastIndexOf("\\")));
      const c = parent && parent.children.find((x) => x.name === p.slice(p.lastIndexOf("\\") + 1));
      if (!c || parent.children.some((x) => x.name === newName)) return false;
      c.name = newName; c.mtime = Date.now(); return true;
    },
    mkdir(p, name) { const n = node(p); if (!n) return null; const e = dir(name, Date.now(), []); n.children.push(e); return e; },
    clone(entry) { return JSON.parse(JSON.stringify(entry)); },
    free: (id) => drives.find((d) => d.id === id).free,
    useSpace(id, bytes) { const d = drives.find((x) => x.id === id); d.free = Math.max(0, d.free - bytes); },
  };
})();
