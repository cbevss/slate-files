---
name: File Explorer
description: A monochrome desktop file explorer of rounded panels floating on black, in a layout the user owns.
colors:
  ground: "#000000"
  panel: "#0f0f0f"
  raised: "#161616"
  hover: "#141414"
  select: "#1f1f1f"
  border: "#2e2e2e"
  ring: "#3d3d3d"
  border-strong: "#4a4a4a"
  focus: "#8f8f8f"
  text: "#ffffff"
  text-strong-quiet: "#d6d6d6"
  text-2: "#a3a3a3"
  text-3: "#808080"
  primary-hover: "#e6e6e6"
typography:
  body:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, Noto Sans, Cantarell, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
    fontFeature: "tnum"
  title:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, Noto Sans, Cantarell, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.45
  headline:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, Noto Sans, Cantarell, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.45
  label:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, Noto Sans, Cantarell, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.45
    letterSpacing: "0.02em"
  caption:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, Noto Sans, Cantarell, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.45
rounded:
  hairline: "2px"
  key: "5px"
  inner: "7px"
  item: "8px"
  control: "10px"
  panel: "12px"
  overlay: "14px"
spacing:
  gutter: "8px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  tabrow: "44px"
  toolbar: "52px"
  statusbar: "44px"
  sidebar: "236px"
  sidebar-max: "420px"
  preview: "340px"
  preview-max: "560px"
components:
  panel:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.panel}"
  button-primary:
    backgroundColor: "{colors.text}"
    textColor: "{colors.ground}"
    rounded: "{rounded.item}"
    height: "32px"
    padding: "0 14px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.item}"
    height: "32px"
    padding: "0 14px"
  button-secondary-hover:
    backgroundColor: "{colors.select}"
  button-quiet:
    textColor: "{colors.text-2}"
    rounded: "{rounded.item}"
    height: "32px"
  icon-button:
    textColor: "{colors.text-strong-quiet}"
    rounded: "9px"
    size: "34px"
  icon-button-hover:
    backgroundColor: "{colors.select}"
    textColor: "{colors.text}"
  tab:
    textColor: "{colors.text-2}"
    rounded: "{rounded.control}"
    height: "34px"
    padding: "0 8px 0 12px"
  tab-hover:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.text-strong-quiet}"
  tab-selected:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.text}"
  segmented-control:
    backgroundColor: "{colors.ground}"
    rounded: "{rounded.control}"
    padding: "3px"
  segmented-thumb:
    backgroundColor: "#2a2a2a"
    rounded: "{rounded.inner}"
    width: "34px"
    height: "28px"
  field:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.text-2}"
    rounded: "{rounded.control}"
    height: "36px"
  crumb:
    textColor: "{colors.text-2}"
    rounded: "{rounded.inner}"
    padding: "4px 9px"
  crumb-current:
    backgroundColor: "{colors.select}"
    textColor: "{colors.text}"
  row:
    textColor: "{colors.text}"
    rounded: "{rounded.item}"
    height: "36px"
    padding: "0 12px"
  row-hover:
    backgroundColor: "{colors.hover}"
  row-selected:
    backgroundColor: "{colors.select}"
  nav-item:
    textColor: "#cfcfcf"
    rounded: "{rounded.item}"
    height: "32px"
    padding: "0 10px"
  nav-item-current:
    backgroundColor: "{colors.select}"
    textColor: "{colors.text}"
  palette:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.overlay}"
    width: "620px"
  dialog:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.overlay}"
    width: "460px"
    padding: "20px"
  menu:
    backgroundColor: "{colors.hover}"
    rounded: "{rounded.panel}"
    padding: "6px"
  toast:
    backgroundColor: "{colors.hover}"
    rounded: "{rounded.panel}"
    padding: "10px 10px 10px 16px"
  usage-track:
    backgroundColor: "{colors.select}"
    rounded: "{rounded.hairline}"
    height: "4px"
---

# Design System: File Explorer

## Overview

**Creative North Star: "Floating Panels on Black"**

Every job in the window is its own rounded panel floating on a pure black ground, separated by thin black gutters, and the arrangement belongs to the user. Tabs, toolbar, sidebar, file list, preview and status are each a near-black slab with a hairline grey border; switching between single, dual and preview layouts makes the panels glide into their new geometry, and splitters resize them with widths remembered.

The world is strictly monochrome: black for ground, white for content, greys for borders, hover and selection. Hierarchy comes from three text greys and three surface steps, never from hue. The interface is dense and quiet in the manner of a native desktop tool (13px system text, 32 to 36px rows), so the files themselves are the loudest thing on screen. White as a fill is reserved for exactly one control: the primary action.

Motion is a soft, decelerating spring with no bounce. Panels animate geometry by transform and clip-path only; content inside them snaps to its final layout so large folders never re-lay out per frame. A panel that leaves the layout exits as a fixed ghost copy at its old position, fading out while sliding 24px to the right.

**Key Characteristics:**
- Pure black ground, 8px gutters, near-black panels with 1px grey borders and 12px corners.
- Strict black, white and grey; no hue anywhere.
- Native density: 13px system UI text, tabular numerals, 36px rows.
- One filled-white control per visible layer.
- Layout glide by FLIP (transform plus clip-path), 300ms, no bounce.

## Colors

A strict achromatic ramp: black ground, three near-black surface steps, three border greys, and three text greys.

### Primary
- **Paper White** (text): content text, and the single filled primary button. Also the transfer progress fill and the text-selection background.

### Neutral
- **True Black** (ground): the window ground and gutters; also the inset background of fields (path bar, search, segmented control, rename input).
- **Panel Black** (panel): every floating panel, the palette and the dialog.
- **Raised Black** (raised): the selected tab and the preview thumbnail well.
- **Hover Black** (hover): hover fill for rows, nav items and tabs; also the surface of the context menu and toasts.
- **Selection Grey** (select): selected rows, the current nav item, the current crumb, menu and palette highlight, button hover.
- **Hairline Grey** (border): the 1px border on every panel, field and secondary button, and internal dividers.
- **Ring Grey** (ring): the selection ring on rows, overlay borders, splitter grip at rest, hover border of buttons and search.
- **Strong Border Grey** (border-strong): the border of the focused file pane in dual mode, and the scrollbar thumb.
- **Focus Grey** (focus): the 2px focus outline, the keyboard-cursor ring, the active splitter grip, the chosen destination in the copy dialog.
- **Soft White** (text-strong-quiet): resting icon-button glyphs and tab hover text, one step below full white.
- **Secondary Grey** (text-2): metadata, column headers, unselected tabs and crumbs, icons in rows.
- **Tertiary Grey** (text-3): sidebar group labels, counts, placeholders, keyboard hints.
- **Pressed White** (primary-hover): hover state of the primary button only.

### Named Rules
**The Monochrome Rule.** No hue, ever. State is shown by surface step, border step and text step; nothing is tinted.

**The AA Floor Rule.** Secondary text is never darker than #a3a3a3 and tertiary never darker than #808080 on the panel surface. These were raised from the original direction (#8f8f8f, #5c5c5c) to clear WCAG AA; do not lower them back. Tertiary text is never used on the Selection Grey fill: on a selected or current item (the current nav item's count, the highlighted palette result's location) it steps up to Secondary Grey.

## Typography

**Body Font:** Segoe UI Variable Text (with Segoe UI, system-ui, Noto Sans, Cantarell, sans-serif)

**Character:** The platform's own UI face, so the app reads as native on Windows and KDE alike. One family, weights 400 and 600 only, with tabular numerals wherever numbers align.

### Hierarchy
- **Title** (600, 16px): dialog headings.
- **Headline** (600, 15px): the previewed file name, the empty-state heading, the palette input.
- **Body** (400, 13px, 1.45): everything else: rows, tabs, buttons, metadata, status.
- **Caption** (400, 12px): palette footer hints, the synthetic-data note.
- **Label** (600, 11px, 0.02em): sidebar group labels (Quick access, Bookmarks, Drives) and palette group labels, in tertiary grey, sentence case.

### Named Rules
**The Tabular Rule.** Sizes, counts, dates and the status bar use tabular numerals so columns and progress figures do not jitter.

**The Two Weights Rule.** 400 for reading, 600 for names and headings. No light or bold extremes.

## Layout

The window is a four-row grid on black: a 44px tab row, a 52px toolbar panel, the flexible body, and a 44px status panel, with 8px gutters between rows and around the edges (the tab row sits flush at the top and doubles as the drag region; window controls bleed to the edge).

The body is a column grid: sidebar (236px default, capped at 420px), the file list (always the widest, minmax(0, 1fr)), an optional second file pane (dual layout), and an optional preview (340px default, capped at 560px). Hidden columns collapse to zero and lose their gutter. Columns are separated by 8px gutters with a splitter centred on each gutter; dragged widths persist per user.

The file list's columns are Name, Modified (150px), Type (130px), Size (96px, right aligned), dropping Type when the pane is mid-width and Modified as well when narrow.

Responsive behaviour targets a desktop window, minimum 960px wide: below 1180px search narrows to 210px; below 1100px the sidebar caps at 212px and preview at 280px, and the preview actions become an equal three-column grid; below 1000px search collapses to icon plus Ctrl K. Below 720px tall the preview thumbnail shrinks from 140px to 112px.

Spacing rhythm is 4px based: 4 between toolbar items, 8 gutter, 12 and 16 for panel padding.

### Named Rules
**The Gutter Rule.** Panels never touch. Every pair of panels is separated by the same 8px of true black.

**The User Owns The Layout Rule.** Layout choice and splitter widths are user state and are remembered; never reset them on navigation.

## Elevation & Depth

Flat by default. In-window panels carry no shadow; depth comes from the ground-to-panel step (black to #0f0f0f) and the hairline border. Shadows exist only on overlays that float above the window, paired with a dimming scrim.

### Shadow Vocabulary
- **Overlay Deep** (`box-shadow: 0 24px 64px rgba(0,0,0,.7)`): command palette and dialog.
- **Overlay Near** (`box-shadow: 0 16px 48px rgba(0,0,0,.7)`): context menu.
- **Toast** (`box-shadow: 0 16px 40px rgba(0,0,0,.6)`): toasts.
- **Scrim** (`rgba(0,0,0,.55)`): behind palette and dialog.

### Named Rules
**The Panels Don't Float Up Rule.** Panels sit on the ground with a border, not a shadow. Only overlays get a shadow, and every overlay also gets the stronger ring border.

## Shapes

Nested, concentric rounding: overlays 14px, panels and menus 12px, controls that sit directly in a panel (tabs, fields, segmented track) 10px, icon buttons 9px, rows, buttons and nav items 8px, controls nested inside a field (crumbs, segmented thumb, menu items) 7px, small chips like tab close and sort buttons 6px, key caps 5px, usage tracks 2px. Every surface has a 1px border; selection adds an inset 1px ring rather than a thicker border. Icons are 16px line drawings, 1.6 stroke, round caps and joins; folders take a 22% fill of their stroke colour.

## Components

### Panels
Quiet slabs that hold one job each.
- **Corner Style:** 12px.
- **Background:** Panel Black, 1px Hairline Grey border, overflow clipped.
- **Shadow Strategy:** none (see Elevation).
- **Focused pane (dual layout):** border steps up to Strong Border Grey; a 38px pane header with the folder name appears.

### Rows and Selection
Dense, calm list rows.
- **Shape:** 36px tall, 8px radius, 2px vertical gap, 12px side padding.
- **Hover:** Hover Black fill (120ms).
- **Selected:** Selection Grey fill plus an inset 1px Ring Grey ring; metadata lightens to #c4c4c4 and icons go white.
- **Keyboard cursor:** inset 1px Focus Grey ring, shown only in keyboard mode.
- **Cut:** 45% opacity. **Enter:** fade up 4px over 260ms.
- **Rename:** inline 26px field, ground background, Focus Grey border.

### Buttons
- **Shape:** 32px tall, 8px radius (icon buttons 34px square, 9px radius).
- **Primary:** Paper White fill and border, black 600 text. Hover Pressed White.
- **Secondary:** transparent with Hairline Grey border; hover Selection Grey fill and Ring Grey border.
- **Quiet:** borderless secondary-grey text, used for Delete in the preview.
- **Press:** scale to 0.98 (120ms).
- **Icon button:** transparent, Soft White glyph; hover Selection Grey; disabled glyph at #3d3d3d.

**The One White Rule.** At most one filled-white button is visible per layer: Open in the preview (or Copy to… when several files are selected), and the confirm button in a dialog, which sits over a scrim. Everything else is outlined, quiet or icon-only.

**Preview actions.** A wrapping row with a 6px gap, 14px 16px padding and a top divider, and 12px button padding. Below 1100px it becomes an equal three-column grid (6px gap, 14px 12px padding), with the buttons centred, unwrapped and padded 0 6px, so the primary keeps its place in the narrow preview.

### Tabs
- 34px tall, 96 to 220px wide, 10px radius, label ellipsised.
- **Resting:** no fill, Secondary Grey text. **Hover:** Hover Black, Soft White text.
- **Selected:** Raised Black fill, Hairline Grey border, white text, close button visible.
- **New tab:** rises 6px and fades in over 260ms.

### Segmented Control (layout switcher)
- Ground-filled track, Hairline Grey border, 10px radius, 3px padding, 2px gap.
- Three 34 by 28px icon buttons; a single #2a2a2a thumb (7px radius) slides under the active one with transform over 280ms on the standard ease.

### Fields (path bar, search)
- 36px tall, 10px radius, True Black fill, Hairline Grey border.
- Path bar holds crumbs (7px radius); the current crumb takes Selection Grey; separators are 12px chevrons.
- Search shows a keyboard hint (5px key cap) and borders up to Ring Grey on hover.

### Splitters
- A 10px hit area centred on the gutter, col-resize cursor.
- Grip is a 3 by 36px Ring Grey bar, 2px radius; on hover or drag it turns Focus Grey and grows to 64px (200ms).

### Overlays
- **Command palette:** 620px wide, 14px radius, Panel Black, Ring Grey border, Overlay Deep shadow; 52px query row, 40px result rows with Selection Grey highlight and underlined matched characters; opens 12vh from the top.
- **Dialog:** 460px, 14px radius, 20px padding, same surface and shadow; destinations are bordered 8px-radius options whose chosen state takes a Focus Grey border; a destination that doesn't fit strikes its size through.
- **Context menu:** min 220px, 12px radius, Hover Black, Ring Grey border, Overlay Near shadow, 32px items with right-aligned shortcut hints.
- **Toast:** bottom centre 64px up, 12px radius, Hover Black, Ring Grey border; enters rising 10px (260ms), leaves falling 6px (200ms).
- All overlays enter by fading in while rising 8px from 98% scale (palette and dialog 220ms, menu 160ms); the scrim fades in over 180ms.

### Status and Transfer
- The status panel shows the selection summary in white and the rest in Secondary Grey, with tabular numerals.
- A running transfer replaces the drive summary: a white label, a 240px usage track with a white fill advancing linearly, and 28px icon buttons for pause and cancel.
- Drive usage tracks in the sidebar are 4px, 2px radius, Selection Grey track with a Secondary Grey fill that eases over 600ms.

## Do's and Don'ts

### Do:
- **Do** keep every job in its own 12px-radius panel on true black with an 8px gutter.
- **Do** animate layout changes with FLIP on transform and clip-path (300ms, cubic-bezier(.22, 1, .36, 1)) and let panel content snap to its final layout; a departing panel leaves as a ghost copy that fades and slides 24px out over 240ms.
- **Do** show selection as a Selection Grey fill plus an inset Ring Grey ring, and keyboard focus with Focus Grey.
- **Do** honour reduced motion: the glide is skipped and all animation collapses to 1ms.
- **Do** keep secondary text at #a3a3a3 and tertiary at #808080 or lighter, and step tertiary up to secondary on any Selection Grey fill.

### Don't:
- **Don't** introduce any hue, tint or coloured accent; the palette is black, white and grey by binding commitment.
- **Don't** fill more than one button white per layer.
- **Don't** animate grid tracks or widths per frame for the layout switch; it re-lays out large folders on every frame.
- **Don't** put shadows on in-window panels; shadows belong to overlays only.
- **Don't** bounce or overshoot content in motion.
