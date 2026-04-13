import {
  TabGroupModel,
  type TabGroupModelSnapshot,
} from "../modules/tabGroupModel.ts";
import {
  deserializeTabGroupStore,
  serializeTabGroupStore,
} from "../modules/tabGroupStore.ts";
import {
  createZoteroTabAdapter,
  type ZoteroTabAdapter,
} from "../modules/zoteroTabAdapter.ts";
import { TabGroupUI } from "../modules/tabGroupUI.ts";
import { TabGroupCommandHandler } from "../modules/tabGroupCommands.ts";

const TAB_GROUP_STORE_PREF = "extensions.zotero.grouptag.tabGroupStore";
const STYLESHEET_URI = "chrome://grouptag/content/tabGroupStyles.css";

export interface PluginRuntime {
  dispose(): void;
}

export interface TabGroupPersistence {
  load(): TabGroupModelSnapshot | undefined;
  save(snapshot: TabGroupModelSnapshot): void;
}

interface RuntimeUI {
  mount(): void;
  unmount(): void;
  update(): void;
}

export interface PluginRuntimeOptions {
  readonly adapter?: ZoteroTabAdapter;
  readonly model?: TabGroupModel;
  readonly persistence?: TabGroupPersistence;
  readonly window?: Window;
  readonly uiFactory?: (
    model: TabGroupModel,
    adapter: ZoteroTabAdapter,
    commands: TabGroupCommandHandler,
  ) => RuntimeUI;
}

class GroupTagPluginRuntime implements PluginRuntime {
  private _disposed = false;
  private readonly _model: TabGroupModel;
  private readonly _adapter: ZoteroTabAdapter;
  private readonly _commands: TabGroupCommandHandler;
  private readonly _ui: RuntimeUI;
  private readonly _persistence: TabGroupPersistence;
  private readonly _window?: Window;

  constructor(options: PluginRuntimeOptions = {}) {
    this._window = options.window;
    this._model = options.model ?? new TabGroupModel();
    this._adapter = options.adapter ?? createZoteroTabAdapter();
    this._persistence =
      options.persistence ?? new ZoteroPrefsTabGroupPersistence();

    const persistedSnapshot = this._persistence.load();
    if (persistedSnapshot) {
      this._model.replaceSnapshot(persistedSnapshot);
    }

    this._commands = new TabGroupCommandHandler(this._model, () => {
      this.persistState();
      this._ui.update();
    });

    const doc = this.getGlobalDocument();
    dump("[GroupTag] Document available: " + !!doc + "\n");

    this._ui =
      options.uiFactory?.(this._model, this._adapter, this._commands) ??
      new TabGroupUI(this._model, this._adapter, this._commands, doc);

    this._ui.mount();
    this.injectStylesheet();

    dump("[GroupTag] Runtime created\n");
  }

  dispose(): void {
    if (this._disposed) {
      return;
    }

    this.persistState();
    this._ui.unmount();
    this.removeStylesheet();

    this._disposed = true;
    dump("[GroupTag] Runtime disposed\n");
  }

  private injectStylesheet(): void {
    const win = this.getGlobalWindow();
    if (!win) {
      dump("[GroupTag] injectStylesheet: no window\n");
      return;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wUtils = (win as any).windowUtils;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svc = (globalThis as any).Services;
      if (!wUtils || !svc?.io) {
        dump("[GroupTag] injectStylesheet: windowUtils or Services unavailable\n");
        return;
      }

      const uri = svc.io.newURI(STYLESHEET_URI);
      wUtils.loadSheet(uri, wUtils.AUTHOR_SHEET);
      dump("[GroupTag] injectStylesheet: loaded via windowUtils\n");
    } catch (e) {
      dump("[GroupTag] injectStylesheet failed: " + e + "\n");
    }
  }

  private removeStylesheet(): void {
    const win = this.getGlobalWindow();
    if (!win) return;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wUtils = (win as any).windowUtils;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svc = (globalThis as any).Services;
      if (!wUtils || !svc?.io) return;

      const uri = svc.io.newURI(STYLESHEET_URI);
      wUtils.removeSheet(uri, wUtils.AUTHOR_SHEET);
    } catch (_e) {
      // Ignore — sheet may not be loaded
    }
  }

  private getGlobalWindow(): Window | undefined {
    if (this._window) {
      return this._window;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const zotero = (globalThis as any).Zotero;
    return zotero?.getMainWindow?.() as Window | undefined;
  }

  private getGlobalDocument(): Document | undefined {
    return this.getGlobalWindow()?.document;
  }

  private persistState(): void {
    this._persistence.save(this._model.getSnapshot());
  }
}

class ZoteroPrefsTabGroupPersistence implements TabGroupPersistence {
  load(): TabGroupModelSnapshot | undefined {
    const serializedSnapshot = getZoteroPrefs().get(TAB_GROUP_STORE_PREF);
    if (
      typeof serializedSnapshot !== "string" ||
      serializedSnapshot.length === 0
    ) {
      return undefined;
    }

    return deserializeTabGroupStore(serializedSnapshot);
  }

  save(snapshot: TabGroupModelSnapshot): void {
    getZoteroPrefs().set(
      TAB_GROUP_STORE_PREF,
      serializeTabGroupStore(snapshot),
    );
  }
}

function getZoteroPrefs(): ZoteroPrefsRuntime {
  const globalZotero = (
    globalThis as typeof globalThis & { Zotero?: ZoteroRuntime }
  ).Zotero;

  if (!globalZotero?.Prefs) {
    throw new Error("Zotero.Prefs is unavailable");
  }

  return globalZotero.Prefs;
}

interface ZoteroRuntime {
  readonly Prefs?: ZoteroPrefsRuntime;
}

interface ZoteroPrefsRuntime {
  get(key: string): unknown;
  set(key: string, value: string): void;
}

export function createPluginRuntime(
  options: PluginRuntimeOptions = {},
): PluginRuntime {
  return new GroupTagPluginRuntime(options);
}
