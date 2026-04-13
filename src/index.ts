/* eslint-disable @typescript-eslint/no-explicit-any */

// Bridge Zotero globals from scope chain to globalThis.
// bootstrap.js loads this bundle via Services.scriptloader.loadSubScript
// into a sandbox object where Zotero is available through the scope chain
// but is not a direct property of globalThis. Several modules access it
// via (globalThis as ...).Zotero, so we bridge it here.
(globalThis as any).Zotero = Zotero;

// Zotero_Tabs is a separate window-level global that may not exist until
// the main window loads. Define a lazy getter so modules that read
// (globalThis as ...).Zotero_Tabs find it when the adapter runs.
if (!Object.getOwnPropertyDescriptor(globalThis, "Zotero_Tabs")) {
  Object.defineProperty(globalThis, "Zotero_Tabs", {
    get(): unknown {
      return (Zotero as any).getMainWindow?.()?.Zotero_Tabs;
    },
    configurable: true,
  });
}

/* eslint-enable @typescript-eslint/no-explicit-any */

import { onStartup, onMainWindowLoad, onShutdown } from "./hooks.ts";

// Register plugin hooks on the Zotero global.
// bootstrap.js dispatches lifecycle events via Zotero.GroupTag.hooks.<name>().
// @ts-expect-error - GroupTag is not in the Zotero type definitions
Zotero.GroupTag = {
  hooks: {
    onStartup,
    onMainWindowLoad(window: Window): void {
      onMainWindowLoad(window);
    },
    onMainWindowUnload(_window: Window): void {
      // Cleanup is handled in onShutdown.
    },
    onShutdown,
  },
};
