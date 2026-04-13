import { expect } from "chai";

import { TabGroupCommandHandler } from "../src/modules/tabGroupCommands.ts";
import {
  TAB_GROUP_STORE_VERSION,
  deserializeTabGroupStore,
} from "../src/modules/tabGroupStore.ts";
import { TabGroupModel } from "../src/modules/tabGroupModel.ts";
import { TabGroupUI } from "../src/modules/tabGroupUI.ts";
import type {
  OpenReaderTabSnapshot,
  ZoteroTabAdapter,
} from "../src/modules/zoteroTabAdapter.ts";

class MockDOMElement {
  id: string;
  className = "";
  textContent = "";
  parentNode: MockDOMElement | null = null;
  children: MockDOMElement[] = [];
  attributes = new Map<string, string>();
  eventListeners = new Map<string, Array<(event: Event) => void>>();

  constructor(id = "") {
    this.id = id;
  }

  addEventListener(type: string, listener: (event: Event) => void): void {
    const listeners = this.eventListeners.get(type) ?? [];
    listeners.push(listener);
    this.eventListeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: Event) => void): void {
    const listeners = this.eventListeners.get(type) ?? [];
    this.eventListeners.set(
      type,
      listeners.filter((entry) => entry !== listener),
    );
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  appendChild(child: MockDOMElement): void {
    this.children.push(child);
    child.parentNode = this;
  }

  insertBefore(newNode: MockDOMElement, referenceNode: MockDOMElement): void {
    const index = this.children.indexOf(referenceNode);
    if (index === -1) {
      this.appendChild(newNode);
      return;
    }

    this.children.splice(index, 0, newNode);
    newNode.parentNode = this;
  }

  removeChild(child: MockDOMElement): void {
    const index = this.children.indexOf(child);
    if (index === -1) {
      return;
    }

    this.children.splice(index, 1);
    child.parentNode = null;
  }

  cloneNode(_deep?: boolean): MockDOMElement {
    const clone = new MockDOMElement(this.id);
    clone.className = this.className;
    clone.textContent = this.textContent;
    for (const [k, v] of this.attributes) {
      clone.attributes.set(k, v);
    }
    return clone;
  }

  replaceChild(newChild: MockDOMElement, oldChild: MockDOMElement): void {
    const index = this.children.indexOf(oldChild);
    if (index === -1) return;
    oldChild.parentNode = null;
    this.children[index] = newChild;
    newChild.parentNode = this;
  }

  get classList(): {
    add: (className: string) => void;
    remove: (className: string) => void;
    contains: (className: string) => boolean;
  } {
    return {
      add: (className: string): void => {
        const classes = this.className.split(" ").filter(Boolean);
        if (!classes.includes(className)) {
          classes.push(className);
          this.className = classes.join(" ");
        }
      },
      remove: (className: string): void => {
        const classes = this.className.split(" ").filter(Boolean);
        this.className = classes
          .filter((entry) => entry !== className)
          .join(" ");
      },
      contains: (className: string): boolean => {
        return this.className.split(" ").filter(Boolean).includes(className);
      },
    };
  }

  querySelectorAll(selector: string): MockDOMElement[] {
    const results: MockDOMElement[] = [];

    const visit = (node: MockDOMElement): void => {
      if (matchesSelector(node, selector)) {
        results.push(node);
      }

      for (const child of node.children) {
        visit(child);
      }
    };

    visit(this);

    return results;
  }

  querySelector(selector: string): MockDOMElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

function matchesSelector(node: MockDOMElement, selector: string): boolean {
  const attrMatch = /^\[(\w[\w-]*)="([^"]+)"\]$/.exec(selector);
  if (attrMatch) {
    return node.getAttribute(attrMatch[1]) === attrMatch[2];
  }
  if (selector.includes(" ")) {
    const parts = selector.trim().split(/\s+/);
    const leafClass = parts[parts.length - 1].replace(".", "");
    if (!node.classList.contains(leafClass)) return false;
    let ancestor = node.parentNode;
    for (let i = parts.length - 2; i >= 0; i--) {
      const cls = parts[i].replace(".", "");
      while (ancestor && !ancestor.classList.contains(cls)) {
        ancestor = ancestor.parentNode;
      }
      if (!ancestor) return false;
      ancestor = ancestor.parentNode;
    }
    return true;
  }
  if (selector.startsWith(".")) {
    return node.classList.contains(selector.slice(1));
  }
  return false;
}

class MockDocument {
  readonly body = new MockDOMElement("body");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  defaultView: any = { setTimeout };
  private readonly _elements = new Map<string, MockDOMElement>();
  private readonly _tabContainer: MockDOMElement;
  private readonly _popupSet: MockDOMElement;

  constructor() {
    const tabsWrapper = new MockDOMElement();
    tabsWrapper.className = "tabs-wrapper";
    this._tabContainer = new MockDOMElement();
    this._tabContainer.className = "tabs";
    tabsWrapper.appendChild(this._tabContainer);
    this._popupSet = new MockDOMElement("mainPopupSet");

    this._elements.set(this._popupSet.id, this._popupSet);
    this.body.appendChild(tabsWrapper);
    this.body.appendChild(this._popupSet);
  }

  getElementById(id: string): MockDOMElement | null {
    return this._elements.get(id) ?? null;
  }

  querySelector(selector: string): MockDOMElement | null {
    return this.body.querySelector(selector);
  }

  createElementNS(_namespace: string, _tagName: string): MockDOMElement {
    return new MockDOMElement();
  }

  querySelectorAll(selector: string): MockDOMElement[] {
    return this.body.querySelectorAll(selector);
  }

  addTabElement(id: string): MockDOMElement {
    const element = new MockDOMElement();
    element.setAttribute("data-id", id);
    this._tabContainer.appendChild(element);
    return element;
  }
}

class MockTabAdapter implements ZoteroTabAdapter {
  tabs: OpenReaderTabSnapshot[] = [];
  private _listeners: Array<(tabs: readonly OpenReaderTabSnapshot[]) => void> =
    [];

  getOpenReaderTabs(): OpenReaderTabSnapshot[] {
    return this.tabs;
  }

  subscribe(
    listener: (tabs: readonly OpenReaderTabSnapshot[]) => void,
  ): () => void {
    this._listeners.push(listener);

    return (): void => {
      this._listeners = this._listeners.filter((entry) => entry !== listener);
    };
  }
}

function createTab(tabId: string): OpenReaderTabSnapshot {
  return {
    tabId,
    title: `Tab ${tabId}`,
    selected: false,
    readerType: "pdf",
    identity: {
      tabId,
      stableId: `tab:${tabId}`,
      itemId: undefined,
      libraryId: undefined,
      key: undefined,
    },
  };
}

function requireDefined<T>(value: T | undefined, label: string): T {
  expect(value, `${label} should be defined during test setup`).to.not.equal(
    undefined,
  );

  return value as T;
}

describe("tab group interaction hardening", function () {
  describe("TabGroupCommandHandler", function () {
    it("rejects invalid rename inputs without throwing or emitting change", function () {
      const model = new TabGroupModel();
      let stateChanges = 0;
      const handler = new TabGroupCommandHandler(model, () => {
        stateChanges++;
      });
      const group = requireDefined(
        handler.createGroup("Research"),
        "Research group",
      );

      let result: ReturnType<TabGroupCommandHandler["renameGroup"]>;
      expect(() => {
        result = handler.renameGroup(group.id, "   ");
      }).to.not.throw();

      expect(result).to.equal(undefined);
      expect(stateChanges).to.equal(1);
      expect(model.getGroup(group.id)?.name).to.equal("Research");
    });

    it("rejects invalid recolor inputs without throwing or emitting change", function () {
      const model = new TabGroupModel();
      let stateChanges = 0;
      const handler = new TabGroupCommandHandler(model, () => {
        stateChanges++;
      });
      const group = requireDefined(
        handler.createGroup("Research", "blue"),
        "Research group",
      );

      let result: ReturnType<TabGroupCommandHandler["recolorGroup"]>;
      expect(() => {
        result = handler.recolorGroup(group.id, "magenta");
      }).to.not.throw();

      expect(result).to.equal(undefined);
      expect(stateChanges).to.equal(1);
      expect(model.getGroup(group.id)?.color).to.equal("blue");
    });

    it("keeps original assignments on invalid reassignment attempts", function () {
      const model = new TabGroupModel();
      let stateChanges = 0;
      const handler = new TabGroupCommandHandler(model, () => {
        stateChanges++;
      });
      const firstGroup = requireDefined(
        handler.createGroup("Research"),
        "Research group",
      );
      const secondGroup = requireDefined(
        handler.createGroup("Writing"),
        "Writing group",
      );

      expect(handler.assignTab(firstGroup.id, "tab-1")).to.equal(true);
      expect(handler.assignTab(secondGroup.id, "tab-1")).to.equal(false);
      expect(stateChanges).to.equal(3);
      expect(model.getGroup(firstGroup.id)?.tabIds).to.deep.equal(["tab-1"]);
      expect(model.getGroup(secondGroup.id)?.tabIds).to.deep.equal([]);
    });

    it("releases owned tabs when deleting a populated group", function () {
      const model = new TabGroupModel();
      const handler = new TabGroupCommandHandler(model);
      const firstGroup = requireDefined(
        handler.createGroup("Research"),
        "Research group",
      );
      const secondGroup = requireDefined(
        handler.createGroup("Writing"),
        "Writing group",
      );

      expect(handler.assignTab(firstGroup.id, "tab-1")).to.equal(true);
      expect(handler.deleteGroup(firstGroup.id)).to.equal(true);
      expect(handler.assignTab(secondGroup.id, "tab-1")).to.equal(true);
      expect(model.getGroup(secondGroup.id)?.tabIds).to.deep.equal(["tab-1"]);
    });

    it("allows rename collisions because commands are keyed by group id", function () {
      const model = new TabGroupModel();
      const handler = new TabGroupCommandHandler(model);
      const firstGroup = requireDefined(
        handler.createGroup("Research"),
        "Research group",
      );
      const secondGroup = requireDefined(
        handler.createGroup("Writing"),
        "Writing group",
      );

      expect(
        handler.renameGroup(secondGroup.id, firstGroup.name)?.name,
      ).to.equal("Research");
      expect(model.groups.map((group) => group.id)).to.deep.equal([
        firstGroup.id,
        secondGroup.id,
      ]);
      expect(model.groups.map((group) => group.name)).to.deep.equal([
        "Research",
        "Research",
      ]);
    });
  });

  describe("tabGroupStore", function () {
    it("rehydrates empty groups and duplicate names predictably", function () {
      const restored = deserializeTabGroupStore(
        JSON.stringify({
          version: TAB_GROUP_STORE_VERSION,
          groups: [
            {
              id: "group-empty",
              name: "Research",
              color: "blue",
              tabIds: [],
            },
            {
              id: "group-active",
              name: "Research",
              color: "green",
              tabIds: ["tab-1"],
            },
          ],
          activeGroupId: "group-active",
        }),
      );

      expect(restored).to.deep.equal({
        groups: [
          {
            id: "group-empty",
            name: "Research",
            color: "blue",
            tabIds: [],
          },
          {
            id: "group-active",
            name: "Research",
            color: "green",
            tabIds: ["tab-1"],
          },
        ],
        activeGroupId: "group-active",
      });
    });

    it("normalizes persisted group names during startup rehydrate", function () {
      const restored = deserializeTabGroupStore(
        JSON.stringify({
          version: TAB_GROUP_STORE_VERSION,
          groups: [
            {
              id: "group-research",
              name: "  Research  ",
              color: "blue",
              tabIds: [],
            },
          ],
        }),
      );

      expect(restored?.groups[0]?.name).to.equal("Research");
    });

    it("rejects whitespace-only stored identifiers and tab ids", function () {
      expect(
        deserializeTabGroupStore(
          JSON.stringify({
            version: TAB_GROUP_STORE_VERSION,
            groups: [
              {
                id: "   ",
                name: "Research",
                color: "blue",
                tabIds: [],
              },
            ],
          }),
        ),
      ).to.equal(undefined);

      expect(
        deserializeTabGroupStore(
          JSON.stringify({
            version: TAB_GROUP_STORE_VERSION,
            groups: [
              {
                id: "group-research",
                name: "Research",
                color: "blue",
                tabIds: ["   "],
              },
            ],
          }),
        ),
      ).to.equal(undefined);
    });
  });

  describe("TabGroupUI", function () {
    let originalZotero: unknown;
    let originalComponents: unknown;
    let originalMutationObserver: unknown;

    beforeEach(function () {
      originalZotero = (globalThis as { Zotero?: unknown }).Zotero;
      originalComponents = (globalThis as { Components?: unknown }).Components;
      originalMutationObserver = (globalThis as { MutationObserver?: unknown })
        .MutationObserver;
    });

    afterEach(function () {
      if (originalZotero !== undefined) {
        (globalThis as { Zotero?: unknown }).Zotero = originalZotero;
      } else {
        delete (globalThis as { Zotero?: unknown }).Zotero;
      }

      if (originalComponents !== undefined) {
        (globalThis as { Components?: unknown }).Components =
          originalComponents;
      } else {
        delete (globalThis as { Components?: unknown }).Components;
      }

      if (originalMutationObserver !== undefined) {
        (globalThis as { MutationObserver?: unknown }).MutationObserver =
          originalMutationObserver;
      } else {
        delete (globalThis as { MutationObserver?: unknown }).MutationObserver;
      }
    });

    function installNativeMenuGlobals(
      doc: MockDocument,
      promptValue: string,
    ): {
      registeredMenus: Array<{
        menuID: string;
        pluginID: string;
        target: string;
        menus: Array<{
          l10nID?: string;
          menus?: Array<{ l10nID?: string }>;
          onCommand?: (
            event: Event,
            context: { tabID: string; tabType: string },
          ) => void;
        }>;
      }>;
    } {
      const registeredMenus: Array<{
        menuID: string;
        pluginID: string;
        target: string;
        menus: Array<{
          l10nID?: string;
          menus?: Array<{ l10nID?: string }>;
          onCommand?: (
            event: Event,
            context: { tabID: string; tabType: string },
          ) => void;
        }>;
      }> = [];

      const promptService = {
        prompt(
          _window: unknown,
          _title: string,
          _message: string,
          result: { value: string },
        ): boolean {
          result.value = promptValue;
          return true;
        },
        alert(): void {
          return undefined;
        },
        confirm(): boolean {
          return true;
        },
      };

      const MockMO = class {
        disconnect(): void {
          return undefined;
        }
        observe(): void {
          return undefined;
        }
      };

      const zoteroMock = {
        MenuManager: {
          registerMenu(options: {
            menuID: string;
            pluginID: string;
            target: string;
            menus: Array<{
              l10nID?: string;
              menus?: Array<{ l10nID?: string }>;
              onCommand?: (
                event: Event,
                context: { tabID: string; tabType: string },
              ) => void;
            }>;
          }): string {
            registeredMenus.push(options);
            return options.menuID;
          },
          unregisterMenu(): boolean {
            return true;
          },
        },
        getMainWindow(): { document: Document } {
          return { document: doc as unknown as Document };
        },
        log(): void {
          return undefined;
        },
        logError(): void {
          return undefined;
        },
      };

      (globalThis as { Zotero?: unknown }).Zotero = zoteroMock;

      // Wire defaultView so production code accesses Zotero/Services via document
      doc.defaultView = {
        setTimeout,
        MutationObserver: MockMO,
        Zotero: zoteroMock,
        Services: { prompt: promptService },
      };

      (globalThis as { Components?: unknown }).Components = {
        classes: {
          "@mozilla.org/embedcomp/prompt-service;1": {
            getService(): typeof promptService {
              return promptService;
            },
          },
        },
        interfaces: {
          nsIPromptService: {},
        },
      };

      (globalThis as { MutationObserver?: unknown }).MutationObserver = MockMO;

      return { registeredMenus };
    }

    function findMenuByL10nID(
      menus: Array<{
        l10nID?: string;
        menus?: Array<{ l10nID?: string }>;
        onCommand?: (
          event: Event,
          context: { tabID: string; tabType: string },
        ) => void;
      }>,
      l10nID: string,
    ):
      | {
          l10nID?: string;
          menus?: Array<{ l10nID?: string }>;
          onCommand?: (
            event: Event,
            context: { tabID: string; tabType: string },
          ) => void;
        }
      | undefined {
      for (const menu of menus) {
        if (menu.l10nID === l10nID) {
          return menu;
        }
      }

      return undefined;
    }

    it("does not render orphan headers for empty groups on startup", function () {
      const model = new TabGroupModel();
      model.createGroup("Empty Group");

      const adapter = new MockTabAdapter();
      const doc = new MockDocument();
      installNativeMenuGlobals(doc, "unused");
      const ui = new TabGroupUI(
        model,
        adapter,
        undefined,
        doc as unknown as Document,
      );

      ui.mount();

      expect(doc.querySelectorAll(".grouptag-header")).to.have.lengthOf(0);
    });

    it("ignores blank group names from the native tab menu create action", function () {
      const model = new TabGroupModel();
      const adapter = new MockTabAdapter();
      const doc = new MockDocument();
      const nativeMenus = installNativeMenuGlobals(doc, "   ");
      const commands = new TabGroupCommandHandler(model);
      const ui = new TabGroupUI(
        model,
        adapter,
        commands,
        doc as unknown as Document,
      );

      const tabElement = doc.addTabElement("tab-1");
      adapter.tabs = [createTab("tab-1")];
      ui.mount();

      // Menu index 0 = "Assign to New Group"
      const createItem = nativeMenus.registeredMenus[0]?.menus?.[0];

      expect(tabElement).to.not.equal(undefined);
      expect(createItem).to.not.equal(undefined);
      expect(() =>
        createItem?.onCommand?.({} as Event, {
          tabID: "tab-1",
          tabType: "reader",
        }),
      ).to.not.throw();
      expect(model.groups).to.have.lengthOf(0);
    });

    it("stores the open tab stable identity when assigning from the native tab menu", function () {
      const model = new TabGroupModel();
      const adapter = new MockTabAdapter();
      const doc = new MockDocument();
      const nativeMenus = installNativeMenuGlobals(doc, "Research");
      const commands = new TabGroupCommandHandler(model);
      const ui = new TabGroupUI(
        model,
        adapter,
        commands,
        doc as unknown as Document,
      );

      doc.addTabElement("runtime-tab-1");
      adapter.tabs = [
        {
          tabId: "runtime-tab-1",
          title: "Persistent PDF",
          selected: false,
          readerType: "pdf",
          identity: {
            tabId: "runtime-tab-1",
            stableId: "library:1:key:ABC123",
            itemId: 42,
            libraryId: 1,
            key: "ABC123",
          },
        },
      ];

      ui.mount();

      // Menu index 0 = "Assign to New Group"
      const createItem = nativeMenus.registeredMenus[0]?.menus?.[0];

      expect(createItem).to.not.equal(undefined);
      createItem?.onCommand?.({} as Event, {
        tabID: "runtime-tab-1",
        tabType: "reader",
      });

      expect(model.groups).to.have.lengthOf(1);
      expect(model.groups[0]?.tabIds).to.deep.equal(["library:1:key:ABC123"]);
    });
  });
});
