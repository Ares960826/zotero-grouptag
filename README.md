# Zotero GroupTag

Chrome-style visual tab grouping for the Zotero PDF reader.

Adds colored group headers and underline indicators to the Zotero tab bar, lets you create named groups, and manage tab assignments — all from a right-click context menu.

![Zotero tab bar with GroupTag group headers](docs/screenshot-placeholder.png)

## Features

- **Colored group headers** injected before the first tab of each group, styled like Chrome tab groups
- **Per-tab underline indicators** matching the group color
- **Create groups** from any PDF tab via right-click → "Assign to New Group"
- **Rename, recolor, and delete groups** via right-click on the group header
- **Assign tabs** to existing groups via right-click on any PDF tab
- **Remove from group** — tab leaves the group; if it was the last tab, the group is deleted automatically
- **Persistent across sessions** — group assignments are saved in Zotero preferences

## Compatibility

| Zotero | Support |
|--------|---------|
| 7.x    | ✅ Supported |
| 8.x    | ✅ Supported |
| < 7    | ❌ Not supported |

macOS, Windows, and Linux are all supported.

## Installation

1. Go to [Releases](https://github.com/ares/zotero-grouptag/releases/latest)
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

A colored header appears above the first tab of the group.

### Assign more tabs to a group

Right-click any PDF tab → **Assign to: [Group Name]**

### Remove a tab from its group

Right-click the tab → **Remove from Group**

If the group becomes empty it is deleted automatically.

### Rename, recolor, or delete a group

Right-click the group header bar → **Rename Group** / **Change Color** / **Delete Group**

Colors can be any CSS color name (`blue`, `red`, `salmon`) or hex value (`#4e9af1`).

## Building from source

### Requirements

- Node.js 18+
- npm
- Zotero 7 installed at `/Applications/Zotero.app` (macOS) for the dev server

```bash
npm install
```

### Commands

| Command | Purpose |
|---------|---------|
| `npm run build` | Production build → `.scaffold/build/zotero-grouptag.xpi` |
| `npm start` | Dev server with hot-reload (side-loads plugin into Zotero) |
| `npm test` | Run the unit test suite |
| `npm run lint:check` | Prettier + ESLint check |
| `npm run lint:fix` | Auto-fix formatting and lint issues |
| `npx tsc --noEmit` | Type check only |

For the dev server, set:

```bash
export ZOTERO_PLUGIN_ZOTERO_BIN_PATH="/Applications/Zotero.app/Contents/MacOS/zotero"
npm start
```

See [`docs/dev-runtime.md`](docs/dev-runtime.md) for details.

## Architecture

The plugin follows a layered architecture with clear separation between domain model, Zotero integration, and UI:

| Layer | File | Responsibility |
|-------|------|----------------|
| Lifecycle | `src/hooks.ts` | `onStartup` → `onMainWindowLoad` → `onShutdown` |
| Runtime | `src/runtime/pluginRuntime.ts` | Wires all layers together, handles persistence |
| Domain model | `src/modules/tabGroupModel.ts` | Pure in-memory group state, no Zotero dependency |
| Adapter | `src/modules/zoteroTabAdapter.ts` | Reads Zotero tab state, emits change events |
| Commands | `src/modules/tabGroupCommands.ts` | Wraps model mutations, fires state-change callback |
| UI | `src/modules/tabGroupUI.ts` | Injects group headers, registers context menus |
| Persistence | `src/modules/tabGroupStore.ts` | JSON serialization for Zotero prefs |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[AGPL-3.0-or-later](LICENSE)
