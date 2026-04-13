import { expect } from "chai";

import {
  deserializeTabGroupStore,
  serializeTabGroupStore,
} from "../src/modules/tabGroupStore.ts";
import type { TabGroupCommandHandler } from "../src/modules/tabGroupCommands.ts";
import type { TabGroupModelSnapshot } from "../src/modules/tabGroupModel.ts";
import type { ZoteroTabAdapter } from "../src/modules/zoteroTabAdapter.ts";
import { createPluginRuntime } from "../src/runtime/pluginRuntime.ts";

const TAB_GROUP_STORE_PREF_SUFFIX = ".tabGroupStore";

describe("pluginRuntime persistence", function () {
  let originalZotero: ZoteroRuntime | undefined;
  let originalDump: typeof globalThis.dump;

  beforeEach(function () {
    originalZotero = (
      globalThis as typeof globalThis & { Zotero?: ZoteroRuntime }
    ).Zotero;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    originalDump = (globalThis as any).dump;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).dump = (): void => {};
  });

  afterEach(function () {
    if (originalZotero) {
      (globalThis as typeof globalThis & { Zotero?: ZoteroRuntime }).Zotero =
        originalZotero;
      return;
    }

    delete (globalThis as typeof globalThis & { Zotero?: ZoteroRuntime })
      .Zotero;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).dump = originalDump;
  });

  it("rehydrates persisted group state before the UI mounts", function () {
    const prefs = createFakePrefs(
      serializeTabGroupStore({
        groups: [
          {
            id: "group-research",
            name: "Research",
            color: "blue",
            tabIds: ["tab-1"],
          },
        ],
        activeGroupId: "group-research",
      }),
    );

    installFakeZotero(prefs);

    let mountedSnapshot: TabGroupModelSnapshot | undefined;

    const runtime = createPluginRuntime({
      adapter: createAdapter(),
      uiFactory(model) {
        return createFakeUI({
          mount() {
            mountedSnapshot = model.getSnapshot();
          },
        });
      },
    });

    expect(prefs.getCalls).to.have.length(1);
    expect(prefs.getCalls[0]).to.match(/tabGroupStore$/);
    expect(mountedSnapshot).to.deep.equal({
      groups: [
        {
          id: "group-research",
          name: "Research",
          color: "blue",
          tabIds: ["tab-1"],
        },
      ],
      activeGroupId: "group-research",
    });

    runtime.dispose();
  });

  it("disposes UI exactly once when shutdown is called repeatedly", function () {
    const prefs = createFakePrefs();
    installFakeZotero(prefs);

    const lifecycle = {
      mount: 0,
      unmount: 0,
      update: 0,
    };

    const runtime = createPluginRuntime({
      adapter: createAdapter(),
      uiFactory() {
        return createFakeUI({
          mount() {
            lifecycle.mount += 1;
          },
          unmount() {
            lifecycle.unmount += 1;
          },
          update() {
            lifecycle.update += 1;
          },
        });
      },
    });

    runtime.dispose();
    runtime.dispose();

    expect(lifecycle.mount).to.equal(1);
    expect(lifecycle.unmount).to.equal(1);
    expect(prefs.setCalls.length).to.be.greaterThan(0);
  });

  it("persists current group state after command changes and on dispose", function () {
    const prefs = createFakePrefs();
    installFakeZotero(prefs);

    let commands: TabGroupCommandHandler | undefined;

    const runtime = createPluginRuntime({
      adapter: createAdapter(),
      uiFactory(_model, _adapter, commandHandler) {
        commands = commandHandler;
        return createFakeUI();
      },
    });

    const createdGroup = commands?.createGroup("Research", "green");
    expect(createdGroup).to.not.equal(undefined);
    expect(commands?.assignTab(createdGroup!.id, "tab-1")).to.equal(true);

    runtime.dispose();

    expect(prefs.setCalls.length).to.be.greaterThan(1);
    expect(
      prefs.setCalls.every(({ key }) =>
        key.endsWith(TAB_GROUP_STORE_PREF_SUFFIX),
      ),
    ).to.equal(true);

    const lastPersisted = prefs.setCalls[prefs.setCalls.length - 1];
    expect(lastPersisted).to.not.equal(undefined);
    expect(deserializeTabGroupStore(lastPersisted!.value)).to.deep.equal({
      groups: [
        {
          id: createdGroup!.id,
          name: "Research",
          color: "green",
          tabIds: ["tab-1"],
        },
      ],
      activeGroupId: undefined,
    });
  });
});

function createAdapter(): ZoteroTabAdapter {
  return {
    getOpenReaderTabs(): [] {
      return [];
    },
    subscribe(): () => void {
      return () => undefined;
    },
  };
}

function createFakeUI(overrides: Partial<FakeUI> = {}): FakeUI {
  return {
    mount(): void {
      return undefined;
    },
    unmount(): void {
      return undefined;
    },
    update(): void {
      return undefined;
    },
    ...overrides,
  };
}

function createFakePrefs(initialValue?: string): FakePrefs {
  return {
    getCalls: [],
    setCalls: [],
    storedValue: initialValue,
    get(key: string): string | undefined {
      this.getCalls.push(key);
      return this.storedValue;
    },
    set(key: string, value: string): void {
      this.setCalls.push({ key, value });
      this.storedValue = value;
    },
  };
}

function installFakeZotero(prefs: FakePrefs): void {
  (globalThis as typeof globalThis & { Zotero?: ZoteroRuntime }).Zotero = {
    Prefs: prefs,
    log(): void {
      return undefined;
    },
    logError(): void {
      return undefined;
    },
  };
}

interface FakePrefs {
  readonly getCalls: string[];
  readonly setCalls: Array<{ key: string; value: string }>;
  storedValue: string | undefined;
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}

interface FakeUI {
  mount(): void;
  unmount(): void;
  update(): void;
}

interface ZoteroRuntime {
  Prefs: {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
  };
  log(message: string): void;
  logError(error: unknown): void;
}
