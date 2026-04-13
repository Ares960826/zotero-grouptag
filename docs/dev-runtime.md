# Development Runtime

This repo uses the local Zotero app binary through `ZOTERO_PLUGIN_ZOTERO_BIN_PATH`.

## Requirements

- Zotero 7 or 8 installed
- macOS default path: `/Applications/Zotero.app/Contents/MacOS/zotero`
- Windows: path to `zotero.exe`

## Set the runtime env var

Export directly:

```bash
export ZOTERO_PLUGIN_ZOTERO_BIN_PATH="/Applications/Zotero.app/Contents/MacOS/zotero"
```

Or copy `.env.example` to `.env` and load it:

```bash
cp .env.example .env
# edit .env to set your path
source .env
```

## Start the dev runtime

```bash
npm start
```

This runs `zotero-plugin serve`, which launches Zotero with the plugin side-loaded in development mode. Changes to `src/` are rebuilt and reloaded automatically.

## Static verification (no Zotero needed)

```bash
npx tsc --noEmit
npm run lint:check
npm run build
```
