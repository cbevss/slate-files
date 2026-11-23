---
version: 1
slug: "ui-index-html"
primary_target: "ui/index.html"
related_targets: []
---

# Main window

Scope: the file explorer's main window (the app shell every other surface lives in). Visitor mode: Operate.

Audience and job: anyone replacing Windows Explorer / Dolphin; browse, find, select, copy/move/rename/delete, preview, and watch transfers. Content: the user's real filesystem (prototype uses a labelled synthetic demo tree). Constraints: black ground, white text, grey borders (user-pinned); rounded panels, adjustable layouts, smooth animation (user steer); must stay familiar to Explorer users.

Memorable moment: switching layout (single, dual, with preview) and watching the panels glide into their new places.

Unresolved: product name; whether dual-pane shows a second preview; icon set (prototype uses drawn glyphs).

## Direction contract

THESIS: Every job in the window is its own rounded panel floating on black, and the layout belongs to the user. Switch it, resize it, and the panels glide. It refuses the category's fused, edge-to-edge chrome slab with one fixed toolbar.

OWN-WORLD: Pure black ground with 8px black gutters between panels. Panels are near-black #0f0f0f with 1px #2e2e2e borders and a 12px radius. Rows, buttons and crumbs inside them have 8px radii. Text is white for content, #8f8f8f for secondary and #5c5c5c for tertiary. Selection is a #1f1f1f fill with a #3d3d3d ring. The only filled-white control is the single primary action on screen. Type is Segoe UI Variable / system UI with tabular numerals. Motion is a soft spring of 220–320ms, with no bounce on content.

STORY: The visitor always knows where they are (tab, segmented path, highlighted sidebar row). They find anything with Ctrl K, select files, then copy or move them with a fit check against the destination. They watch the transfer progress in the status panel, and they rearrange the window to suit the job.

FIRST VIEWPORT:
- A 44px tab row sits on the black.
- Below it is a 52px toolbar panel: back/forward/up, a segmented breadcrumb, the layout switcher (single / dual / preview) and search showing "Ctrl K".
- Three panels fill the body:
  - a 236px sidebar with quick access, bookmarks, and drives with usage tracks;
  - the details-view file list (the thesis, widest);
  - a 340px preview with a thumbnail, name, metadata, a filled Open button as the primary action, plus Copy to… and Move to….
- A 44px status panel holds the selection summary and the transfer progress.
- Signature interaction: a layout switch animates panel geometry (FLIP), and splitters drag to resize, with widths remembered.

FORM: Floating Panels, card 1 of my safer round-2 lineup (the user picked it, since the assigned index is suspended in the safer register). seed:b002771a63dccc1e

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
