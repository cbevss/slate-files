# Slate

A lightweight file explorer for Windows and Linux. It does what you use Windows Explorer for every day, with a quieter black, white and grey interface and an engine built to be fast where Explorer feels slow: **searching** and **copying**.

![Slate main window](docs/screenshot.png)

## Install

Download the latest installer from [Releases](../../releases):

| System | File |
| --- | --- |
| Windows 10/11 | `Slate_x.y.z_x64-setup.exe` (per-user, no admin) or `Slate_x.y.z_x64_en-US.msi` |
| Fedora (tested target: Fedora 45 KDE Plasma) | `Slate-x.y.z-1.x86_64.rpm`, then `sudo dnf install ./Slate-*.rpm` |
| Debian / Ubuntu | `slate_x.y.z_amd64.deb` |
| Any Linux | `slate_x.y.z_amd64.AppImage` (`chmod +x` and run) |

On Linux, Slate uses the system WebKitGTK 4.1, which `dnf` pulls in automatically.

## What it does

**Everyday Explorer features**
- Tabs, back/forward/up, a clickable breadcrumb (Ctrl+L to type a path) and a sidebar with Quick access, bookmarks and drives.
- Details view with sortable columns. Multi-select with Ctrl, Shift and type-to-select.
- Copy, cut, paste, drag and drop, Copy to… and Move to….
- Rename (F2), new folder (Ctrl+Shift+N), delete to the Recycle Bin or Trash, and permanent delete (Shift+Del).
- Open with the default app, a preview panel and a hidden-files toggle (Ctrl+H).

**Faster where it matters**
- **Instant search (Ctrl+K).** At startup Slate builds an in-memory index of every filename (all drives on Windows; your home folder and mounted media on Linux), so results appear as you type, usually in a few milliseconds.
- **Copy engine.**
  - Moves on the same drive are a rename, so they finish instantly.
  - Small files copy in parallel on 8 workers using the OS's native copy (CopyFileExW on Windows; `copy_file_range` on Linux, which makes instant reflink copies on Fedora's default btrfs).
  - Large files stream in big chunks.
  - Progress starts immediately: there's no slow "calculating" phase.
- **Fit check before you copy.** Copy to… shows whether the files will fit on each destination before you start.

**Extras**
- Dual-pane mode (Ctrl+2) and a preview layout (Ctrl+3). Panels glide between layouts, and the splitters resize and remember their widths.
- Command palette (Ctrl+K) for files, folders and actions.
- Batch rename: name and number, find and replace, or change case, with a live preview.
- Undo (Ctrl+Z) for delete, rename, batch rename, copy, move and new folder.
- Folder sizes, and a duplicate finder that compares file contents with SHA-256.
- SHA-256 checksums for downloads such as ISOs and installers.

## Keyboard

| Keys | Action |
| --- | --- |
| Ctrl+K / Ctrl+F | Search everything and run actions |
| Ctrl+T, Ctrl+W, Ctrl+Tab | New, close and next tab |
| Ctrl+1 / 2 / 3 | Single, two panes, preview layout |
| Alt+Left/Right/Up, Backspace | Back, forward, up |
| Ctrl+L | Type a location |
| F2 | Rename; with several items selected, batch rename |
| Del / Shift+Del | Recycle Bin / permanent delete |
| Ctrl+C / X / V, Ctrl+Z | Clipboard, undo |
| Ctrl+H | Show hidden files |
| Tab (two panes) | Switch pane |

## Build from source

You need Rust (stable), Node 18+ and the [Tauri prerequisites](https://tauri.app/start/prerequisites/): MSVC Build Tools on Windows, or `webkit2gtk4.1-devel gtk3-devel` on Fedora.

```sh
npm install
npm run dev      # run the app
npm run build    # installers in src-tauri/target/release/bundle/
npm run preview  # just the UI in a browser, on built-in sample files
```

Pushing a tag such as `v0.1.0` makes GitHub Actions build the Windows and Linux installers, check the `.rpm` installs on Fedora 45, and attach everything to a draft release.

## Project layout

```
ui/          interface (plain HTML/CSS/JS, no build step)
  fs.js      one async file API: Rust engine in the app, sample data in a browser
src-tauri/
  src/fsops.rs     listing, drives, rename, trash/restore, sizes, hashes, duplicates
  src/index.rs     the in-memory search index
  src/transfer.rs  the parallel copy/move engine
DESIGN.md    the visual system (colours, type, spacing, motion, components)
PRODUCT.md   who Slate is for and the principles behind it
```

## Known limits

- The search index refreshes every 10 minutes and on demand ("Rebuild the search index" in Ctrl+K). Files created in the meantime appear in folders straight away but not in search until the next refresh. A live file watcher is planned.
- Windows shell extensions (third-party right-click entries) and OneDrive status icons are not supported.
- On Windows, the index walks drives normally. Reading the NTFS Master File Table directly, which is faster but needs admin, is planned.

## License

MIT
