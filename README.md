# Zotero GroupTag

[简体中文](README.zh-CN.md) | English

Chrome-style visual tab grouping for the Zotero PDF reader.

Adds colored group headers and underline indicators to the Zotero tab bar, lets
you create named groups, collapse them without closing PDFs, and manage tab
assignments from a right-click context menu.

![Zotero tab bar with GroupTag group headers](docs/screenshot.png)

## Features

- **Colored group headers** styled like Chrome tab groups
- **Automatic initial colors** with a 33-color palette for later changes
- **Per-tab underline indicators** matching the group color
- **Collapsible groups** that hide grouped tabs without closing their PDFs
- **Stable group movement** with a clear drop marker while surrounding tabs stay still
- **Contiguous groups** that stay together while preserving manual ordering inside each group
- **Create groups** from any PDF tab via right-click → "Assign to New Group"
- **Rename, recolor, collapse, expand, and delete groups** via the group header
- **Assign tabs** to existing groups via right-click on any PDF tab
- **Empty-group choice** — when the last tab is removed, choose whether to delete or keep the group
- **Persistent across sessions** — group assignments are saved in Zotero preferences

## Compatibility

| Zotero | Support          |
| ------ | ---------------- |
| 9.x    | ✅ Supported     |
| 8.x    | ✅ Supported     |
| 7.x    | ✅ Supported     |
| < 7    | ❌ Not supported |

macOS, Windows, and Linux are all supported.

## Installation

1. Go to [Releases](https://github.com/Ares960826/zotero-grouptag/releases/latest)
2. Download `zotero-grouptag.xpi`
3. In Zotero: **Tools → Add-ons → gear icon → Install Add-on From File…**
4. Select the downloaded `.xpi` file
5. Restart Zotero when prompted

## Usage

### Create a group

1. Open two or more PDFs in Zotero
2. Right-click any PDF tab
3. Click **Assign to New Group**
4. Enter a group name and press OK

A colored header appears immediately inside the first tab of the group. New
groups receive distinct colors automatically whenever possible. Grouped tabs
are kept together automatically, and you can drag tabs to reorder them within
the group.

### Collapse or expand a group

Click the colored group header, or right-click it and choose **Collapse Group**
or **Expand Group**. Collapsing only hides the group's tab buttons; the PDFs
remain open in Zotero.

### Move a group

An expanded group cannot be dragged as one unit. This keeps individual PDF
tabs readable and avoids interfering with Zotero's native tab ordering.

To move the whole group, collapse it first, then drag the collapsed colored
group header. A drop marker shows the destination while the surrounding tabs
stay still; the group moves as one unit when you release it. Expand it again
after moving if needed.

Expanded groups intentionally stay fixed because moving the header and all
visible PDF tabs as one block would conflict with Zotero's native tab dragging.

### Assign more tabs to a group

Right-click any PDF tab → **Assign to: [Group Name]**

### Remove a tab from its group

Right-click the tab → **Remove from Group**

When removing the last tab, Zotero GroupTag asks whether to delete the group or
keep the empty group for later reuse.

### Rename, recolor, collapse, or delete a group

Right-click the group header bar and choose the required action.

Choose **Change Color** to select another color from the 33-color visual
palette. Newly created groups receive a distinct color automatically whenever
possible, so manual color selection is optional.

## License

[AGPL-3.0-or-later](LICENSE)
