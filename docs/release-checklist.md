# Release Checklist

## 1. Static verification

Run from a clean working tree:

```bash
npx tsc --noEmit
npm run lint:check
npm run build
```

Expected:
- All three commands exit with code 0
- `.scaffold/build/zotero-grouptag.xpi` is produced
- `manifest.json` in the build contains correct Zotero version bounds

## 2. Unit tests

```bash
npm test
```

All tests must pass.

## 3. Local install smoke check

```bash
npm run build
```

Then in Zotero: **Tools → Add-ons → gear → Install Add-on From File…**, select `.scaffold/build/zotero-grouptag.xpi`.

Verify:
1. Zotero loads the add-on without install warnings
2. Opening multiple PDF tabs shows group headers in the tab strip
3. Right-click on a PDF tab → "Assign to New Group" works
4. Rename, recolor, and delete from the group header work
5. Remove from Group removes the tab; empty groups are deleted automatically

## 4. Package metadata check

Before tagging a release, confirm:

- `package.json` version, description, author
- `package.json > zotero-plugin` update URL and XPI download link match the release repository
- `addon/manifest.json` contains correct Zotero version bounds
- `addon/install.rdf` version and description are current
- README feature list matches the actual implemented features

## 5. GitHub release

```bash
npm run release
```

Attach the generated `.xpi` and `update.json` to the GitHub release. The update URL in `package.json` must point to the release artifacts so Zotero's auto-update mechanism works.
