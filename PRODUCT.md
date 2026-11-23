# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(Desktop app: the UI is web technology rendered in the OS webview by Tauri, on Windows and Linux. There is no browser or mobile target.)

## Stack

Tauri 2: a Rust backend for the filesystem engine (listing, search index, copy/move, file watching), and a web frontend rendered in the system webview (WebView2 on Windows, WebKitGTK on Linux). The user chose this over Qt 6 and Electron for small installers, fast startup and low memory use.

Distribution: Windows `.exe` (NSIS) and `.msi`; Linux `.rpm` (primary target: Fedora 45, KDE Plasma 6, Wayland) plus AppImage. Built by GitHub Actions and published from a new GitHub repository. Repo name and public/private visibility are still undecided; confirm them before the first push.

## Users

Everyone: a general replacement for Windows Explorer (and for Dolphin on KDE) that anyone can install and use straight away, with no learning curve. Power-user features (keyboard, dual pane, command palette) are there for people who want them but are never required.

## Product Purpose

A lightweight file explorer that covers everyday Windows Explorer tasks, looks cleaner, and is clearly faster where Explorer feels slow: searching for files and copying or moving them. Success means someone switches to it as their default file manager and doesn't go back.

## Positioning

Explorer-level familiarity with noticeably faster search and copying. Search runs against an always-up-to-date index (on NTFS it reads the Master File Table directly), so results appear as you type instead of after a crawl. Copying uses parallel workers and native fast paths (CopyFileEx on Windows; copy_file_range and reflink on Linux), with a pause/resume queue. The same app and behaviour on Windows and Fedora KDE.

## Operating Context

- Daily file management: browsing, opening, organising downloads, moving project folders, clearing disk space.
- Runs alongside the OS shell. On Windows it defers to Explorer for things only the shell owns (shell extensions, OneDrive status, Control Panel). On KDE it follows freedesktop conventions: trash spec, `xdg-open`, `.desktop` entry, and Wayland/X11 with HiDPI scaling.
- Mouse-first users and keyboard-first users both have to be fully served.

## Capabilities and Constraints

Core (Explorer parity for everyday use):
- Browse with address bar/breadcrumbs, back/forward/up, a sidebar (quick access, bookmarks, drives, devices) and details/list/grid views with sorting.
- Copy, cut, paste, move, rename, delete to the recycle bin or trash, permanent delete, new folder/file.
- Drag and drop, context menus, properties, open with, show hidden files, file previews and keyboard shortcuts.

First-version extras the user confirmed:
- Dual-pane mode and tabs.
- Command palette (Ctrl+K).
- Batch rename with patterns, and undo for file operations.
- Folder size view and a duplicate file finder.

Also planned:
- Quick preview (Space).
- Pause/resume transfer queue.

Constraints:
- Speed claims must be honest. A single large file copy is limited by the disk, so the gains come from many-file operations, search, and less UI overhead.
- Shell-only features (third-party shell extensions, OneDrive integration) are out of scope.
- Linux builds can't be tested on real Fedora hardware from the Windows dev machine. They're verified in CI.
- The look is limited to black, white and grey. The user set this as a binding constraint.

## Brand Commitments

- The palette is black, white and grey. The user made this binding: it's the reason for "cleaner UI".
- Palette roles, in the user's words: "black should be the main colour for the backround etc. white for the writing, and grey for the border lines for tabs etc." The app is dark-first. A light theme isn't part of this commitment.
- When choosing the main window's look, the user twice picked the familiar, safer end. They asked for a "nicer ui, adjustable layouts, nice animations, rounded boxes". So: a polished, modern standard, with rounded panels, layouts the user can rearrange and resize, and smooth motion. No expressive concept worlds.
- There's no product name yet. Choose one with the user before creating the repo.

## Evidence on Hand

None yet. There are no benchmarks, users or testimonials. Speed comparisons against Windows Explorer must be measured before anyone states them.

## Product Principles

1. Familiar first: anyone who knows Explorer should be productive in their first minute; power features layer on top.
2. Speed you can feel: search and file operations never block the UI, show progress straight away, and can be cancelled.
3. Never lose a file: destructive actions go to the trash by default, file operations can be undone, and conflicts are always asked about rather than silently overwritten.
4. One app, two OSes: the same behaviour on Windows and Fedora KDE, respecting each platform's file conventions.
5. Quiet interface: the content (files) is the loudest thing on screen.

## Accessibility & Inclusion

Full keyboard operation and visible focus states are required, because the audience is everyone and keyboard power use is a core feature. Contrast must stay legible within the monochrome palette (WCAG AA). Honour the OS text scaling and reduced-motion settings.
