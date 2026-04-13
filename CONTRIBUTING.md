# Contributing to Zotero GroupTag

## Development setup

```bash
npm install
npm run build       # verify the build works
npm test            # run unit tests
```

For the live dev server:

```bash
export ZOTERO_PLUGIN_ZOTERO_BIN_PATH="/Applications/Zotero.app/Contents/MacOS/zotero"
npm start
```

## Code style

- **TypeScript strict mode** — `@typescript-eslint/no-explicit-any` is an error; explicit return types are required on public methods
- **Prettier** enforced — 80-char width, 2 spaces, LF endings; run `npm run lint:fix` before committing
- **Private members** — prefix with `_` (e.g. `_groups`, `_disposed`)
- **Imports** — use `.ts` extensions in intra-module imports; use `type` imports for type-only references

## Testing

Tests are in `test/*.test.ts` using Mocha + Chai (`expect` style). They run against source directly with no Zotero runtime required.

```bash
npm test                                  # full suite
npx mocha test/specific.test.ts           # single file
npx mocha --grep "pattern"               # by name
```

All tests must pass before submitting a pull request.

## Zotero-specific patterns

### Non-obvious APIs

```typescript
// Tab list
const tabs = Zotero_Tabs._tabs;

// Reader instances
const readers = Zotero.Reader._readers;

// Preferences
Zotero.Prefs.set("extensions.zotero.grouptag.key", value);

// XUL elements require the XUL namespace
const item = document.createElementNS(
  "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
  "menuitem",
);
```

### Bootstrap sandbox vs. main window compartment

Gecko runs the plugin bootstrap in a sandbox with a separate `globalThis` from the main window. Key implications:

- Access `MutationObserver` and `setTimeout` via `document.defaultView`, not `globalThis`
- Access `Zotero.MenuManager` via `document.defaultView.Zotero`, not `globalThis.Zotero`
- Use `Services.prompt` instead of `Components.classes` for prompt dialogs
- Use `addEventListener("command", ...)` on XUL menuitems — setting `.oncommand` as a property is silently ignored

### Hook lifecycle

`onStartup()` → `onMainWindowLoad(window)` → `onShutdown()`

UI elements must be initialized in `onMainWindowLoad()`, not `onStartup()`.

## Pull requests

- One logical change per PR
- Include or update tests for new behavior
- Run `npm run lint:fix && npm run build` before opening the PR
