import { expect } from "chai";

import { TabGroupCommandHandler } from "../src/modules/tabGroupCommands.ts";
import { TabGroupModel } from "../src/modules/tabGroupModel.ts";
import { TabGroupUI } from "../src/modules/tabGroupUI.ts";
import type {
  OpenReaderTabSnapshot,
  ZoteroTabAdapter,
} from "../src/modules/zoteroTabAdapter.ts";

interface MenuContextMock {
  readonly menuElem: MockDOMElement;
  readonly tabType: string;
  readonly tabID: string;
  readonly tabSubType?: string;
  readonly items: unknown[];
  setVisible(visible: boolean): void;
  setEnabled(enabled: boolean): void;
  setL10nArgs(l10nArgs: object): void;
  setIcon(icon: string, darkIcon?: string): void;
}

interface RegisteredMenuDefinition {
  readonly menuType: string;
  readonly l10nID?: string;
  readonly menus?: RegisteredMenuDefinition[];
  readonly onCommand?: (event: Event, context: MenuContextMock) => void;
  readonly onShowing?: (event: Event, context: MenuContextMock) => void;
}

interface RegisteredMenuOptions {
  readonly menuID: string;
  readonly pluginID: string;
  readonly target: string;
  readonly menus: RegisteredMenuDefinition[];
}

interface PromptServiceMock {
  readonly promptCalls: Array<{ message: string; defaultText: string }>;
  readonly alertCalls: Array<{ message: string }>;
  readonly confirmCalls: string[];
  prompt(
    _window: unknown,
    _title: string,
    message: string,
    result: { value: string },
  ): boolean;
  alert(_window: unknown, _title: string, message: string): void;
  confirm(_window: unknown, _title: string, message: string): boolean;
}

interface MenuManagerMock {
  readonly registeredMenus: RegisteredMenuOptions[];
  readonly unregisteredMenuIDs: string[];
  registerMenu(options: RegisteredMenuOptions): string | false;
  unregisterMenu(menuID: string): boolean;
}

interface ZoteroMock {
  readonly MenuManager: MenuManagerMock;
  getMainWindow(): { document: Document };
  log(message: string): void;
  logError(error: unknown): void;
}

function matchesSelector(node: MockDOMElement, selector: string): boolean {
  // Attribute selector: [data-id="value"]
  const attrMatch = /^\[(\w[\w-]*)="([^"]+)"\]$/.exec(selector);
  if (attrMatch) {
    return node.getAttribute(attrMatch[1]) === attrMatch[2];
  }
  // Descendant selector: .parent .child
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
  // Simple class selector: .className
  if (selector.startsWith(".")) {
    return node.classList.contains(selector.slice(1));
  }
  return false;
}

class MockDOMElement {
  id = "";
  className = "";
  textContent = "";
  style: Record<string, string> = {};
  parentNode: MockDOMElement | null = null;
  children: MockDOMElement[] = [];
  attributes = new Map<string, string>();
  eventListeners = new Map<string, Array<(event: Event) => void>>();
  openPopupCalls: Array<{ x: number; y: number; isContextMenu: boolean }> = [];
  private readonly _ownerDocument?: MockDocument;

  constructor(id = "", ownerDocument?: MockDocument) {
    this.id = id;
    this._ownerDocument = ownerDocument;
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
    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }

    this.children.push(child);
    child.parentNode = this;
    this._ownerDocument?.registerElement(child);
  }

  insertBefore(newNode: MockDOMElement, referenceNode: MockDOMElement): void {
    if (newNode.parentNode) {
      newNode.parentNode.removeChild(newNode);
    }

    const index = this.children.indexOf(referenceNode);
    if (index === -1) {
      this.appendChild(newNode);
      return;
    }

    this.children.splice(index, 0, newNode);
    newNode.parentNode = this;
    this._ownerDocument?.registerElement(newNode);
  }

  removeChild(child: MockDOMElement): void {
    const index = this.children.indexOf(child);
    if (index === -1) {
      return;
    }

    this.children.splice(index, 1);
    child.parentNode = null;
  }

  querySelector(selector: string): MockDOMElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
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

  openPopupAtScreen(x: number, y: number, isContextMenu: boolean): void {
    this.openPopupCalls.push({ x, y, isContextMenu });
  }

  cloneNode(_deep?: boolean): MockDOMElement {
    const clone = new MockDOMElement(this.id, this._ownerDocument);
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
    this._ownerDocument?.registerElement(newChild);
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

  get previousSibling(): MockDOMElement | null {
    if (!this.parentNode) {
      return null;
    }

    const index = this.parentNode.children.indexOf(this);
    if (index <= 0) {
      return null;
    }

    return this.parentNode.children[index - 1] ?? null;
  }

  get firstChild(): MockDOMElement | null {
    return this.children[0] ?? null;
  }
}

class MockDocument {
  readonly body = new MockDOMElement("body", this);
  readonly head = new MockDOMElement("head", this);
  readonly documentElement = new MockDOMElement("html", this);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  defaultView: any = { setTimeout, MutationObserver: MockMutationObserver };
  private readonly _elements = new Map<string, MockDOMElement>();
  private readonly _tabContainer: MockDOMElement;
  private readonly _popupSet: MockDOMElement;

  constructor() {
    const tabsWrapper = new MockDOMElement("", this);
    tabsWrapper.className = "tabs-wrapper";
    this._tabContainer = new MockDOMElement("", this);
    this._tabContainer.className = "tabs";
    tabsWrapper.appendChild(this._tabContainer);
    this._popupSet = new MockDOMElement("mainPopupSet", this);

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
    return new MockDOMElement("", this);
  }

  querySelectorAll(selector: string): MockDOMElement[] {
    return this.body.querySelectorAll(selector);
  }

  addTabElement(id: string): MockDOMElement {
    const element = new MockDOMElement("", this);
    element.setAttribute("data-id", id);
    this.registerElement(element);
    this._tabContainer.appendChild(element);
    return element;
  }

  getTabContainer(): MockDOMElement {
    return this._tabContainer;
  }

  registerElement(element: MockDOMElement): void {
    if (element.id.length > 0) {
      this._elements.set(element.id, element);
    }

    for (const child of element.children) {
      this.registerElement(child);
    }
  }
}

class MockMutationObserver {
  disconnect(): void {
    return undefined;
  }

  observe(): void {
    return undefined;
  }
}

class MockTabAdapter implements ZoteroTabAdapter {
  tabs: OpenReaderTabSnapshot[] = [];
  listeners: Array<(tabs: readonly OpenReaderTabSnapshot[]) => void> = [];

  getOpenReaderTabs(): OpenReaderTabSnapshot[] {
    return this.tabs;
  }

  subscribe(
    listener: (tabs: readonly OpenReaderTabSnapshot[]) => void,
  ): () => void {
    this.listeners.push(listener);
    return (): void => {
      this.listeners = this.listeners.filter((entry) => entry !== listener);
    };
  }

  emitChange(): void {
    for (const listener of this.listeners) {
      listener(this.tabs);
    }
  }
}

function createTab(
  tabId: string,
  overrides: Partial<OpenReaderTabSnapshot> = {},
): OpenReaderTabSnapshot {
  const { identity: _ignoredIdentity, ...overrideFields } = overrides;
  const overrideIdentity = overrides.identity ?? {};
  return {
    tabId,
    title: `Tab ${tabId}`,
    selected: false,
    readerType: "pdf",
    ...overrideFields,
    identity: {
      tabId,
      stableId: `tab:${tabId}`,
      itemId: undefined,
      libraryId: undefined,
      key: undefined,
      ...overrideIdentity,
    },
  };
}

function triggerEvent(
  element: MockDOMElement,
  eventType: string,
  event: Event,
): void {
  for (const listener of element.eventListeners.get(eventType) ?? []) {
    listener(event);
  }
}

function flushRender(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function createPromptServiceMock(): PromptServiceMock {
  return {
    promptCalls: [],
    alertCalls: [],
    confirmCalls: [],
    prompt(
      _window: unknown,
      _title: string,
      message: string,
      result: { value: string },
    ): boolean {
      this.promptCalls.push({ message, defaultText: result.value });
      return false;
    },
    alert(_window: unknown, _title: string, message: string): void {
      this.alertCalls.push({ message });
    },
    confirm(_window: unknown, _title: string, message: string): boolean {
      this.confirmCalls.push(message);
      return true;
    },
  };
}

function createMenuManagerMock(): MenuManagerMock {
  return {
    registeredMenus: [],
    unregisteredMenuIDs: [],
    registerMenu(options: RegisteredMenuOptions): string | false {
      this.registeredMenus.push(options);
      return options.menuID;
    },
    unregisterMenu(menuID: string): boolean {
      this.unregisteredMenuIDs.push(menuID);
      return true;
    },
  };
}

function createMenuContext(tab: OpenReaderTabSnapshot): MenuContextMock {
  return {
    menuElem: new MockDOMElement("menu-item"),
    tabType: "reader",
    tabID: tab.tabId,
    tabSubType: tab.readerType,
    items: [],
    setVisible(visible: boolean): void {
      this.menuElem.setAttribute("data-visible", String(visible));
    },
    setEnabled(enabled: boolean): void {
      this.menuElem.setAttribute("data-enabled", String(enabled));
    },
    setL10nArgs(_l10nArgs: object): void {
      return undefined;
    },
    setIcon(_icon: string, _darkIcon?: string): void {
      return undefined;
    },
  };
}

function findMenuByL10nID(
  menus: readonly RegisteredMenuDefinition[],
  l10nID: string,
): RegisteredMenuDefinition | undefined {
  for (const menu of menus) {
    if (menu.l10nID === l10nID) {
      return menu;
    }

    const nested = menu.menus
      ? findMenuByL10nID(menu.menus, l10nID)
      : undefined;
    if (nested) {
      return nested;
    }
  }

  return undefined;
}

describe("TabGroupUI", function (): void {
  let originalZotero: ZoteroMock | undefined;
  let originalComponents: unknown;
  let originalMutationObserver: unknown;

  beforeEach(function (): void {
    originalZotero = (globalThis as typeof globalThis & { Zotero?: ZoteroMock })
      .Zotero;
    originalComponents = (globalThis as { Components?: unknown }).Components;
    originalMutationObserver = (globalThis as { MutationObserver?: unknown })
      .MutationObserver;
  });

  afterEach(function (): void {
    if (originalZotero) {
      (globalThis as typeof globalThis & { Zotero?: ZoteroMock }).Zotero =
        originalZotero;
    } else {
      delete (globalThis as typeof globalThis & { Zotero?: ZoteroMock }).Zotero;
    }

    if (originalComponents !== undefined) {
      (globalThis as { Components?: unknown }).Components = originalComponents;
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

  function installGlobals(
    doc: MockDocument,
    promptService: PromptServiceMock,
    menuManager: MenuManagerMock,
  ): void {
    const zotero: ZoteroMock = {
      MenuManager: menuManager,
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

    (globalThis as typeof globalThis & { Zotero?: ZoteroMock }).Zotero = zotero;

    // Wire defaultView so production code can access Zotero and Services
    // through this._document.defaultView (cross-compartment safe path).
    doc.defaultView = {
      setTimeout,
      MutationObserver: MockMutationObserver,
      Zotero: zotero,
      Services: { prompt: promptService },
    };

    (globalThis as { Components?: unknown }).Components = {
      classes: {
        "@mozilla.org/embedcomp/prompt-service;1": {
          getService(): PromptServiceMock {
            return promptService;
          },
        },
      },
      interfaces: {
        nsIPromptService: {},
      },
    };
    (globalThis as { MutationObserver?: unknown }).MutationObserver =
      MockMutationObserver;
  }

  it("renders headers and applies classes/colors for grouped tabs", async function (): Promise<void> {
    const model = new TabGroupModel();
    const adapter = new MockTabAdapter();
    const doc = new MockDocument();
    const promptService = createPromptServiceMock();
    const menuManager = createMenuManagerMock();
    installGlobals(doc, promptService, menuManager);

    const group1 = model.createGroup("Group 1", "blue");
    const group2 = model.createGroup("Group 2", "green");
    model.assignTab(group1.id, "tab:tab-1");
    model.assignTab(group1.id, "tab:tab-2");
    model.assignTab(group2.id, "tab:tab-3");

    const el1 = doc.addTabElement("tab-1");
    const el2 = doc.addTabElement("tab-2");
    const el3 = doc.addTabElement("tab-3");
    const el4 = doc.addTabElement("tab-4");

    adapter.tabs = [
      createTab("tab-1"),
      createTab("tab-2"),
      createTab("tab-3"),
      createTab("tab-4"),
    ];

    const ui = new TabGroupUI(
      model,
      adapter,
      undefined,
      doc as unknown as Document,
    );
    ui.mount();
    await flushRender();

    expect(el1.classList.contains("grouptag-tab")).to.equal(true);
    expect(el1.getAttribute("data-group-color")).to.equal("blue");
    expect(el2.classList.contains("grouptag-tab")).to.equal(true);
    expect(el2.getAttribute("data-group-color")).to.equal("blue");
    expect(el3.classList.contains("grouptag-tab")).to.equal(true);
    expect(el3.getAttribute("data-group-color")).to.equal("green");
    expect(el4.classList.contains("grouptag-tab")).to.equal(false);

    const tabContainer = doc.getTabContainer();
    const header1 =
      tabContainer.children[tabContainer.children.indexOf(el1) - 1];
    const header2 =
      tabContainer.children[tabContainer.children.indexOf(el3) - 1];

    expect(header1.className).to.equal("grouptag-header");
    expect(header1.getAttribute("data-group-id")).to.equal(group1.id);
    expect(header1.children[0]?.textContent).to.equal("Group 1");

    expect(header2.className).to.equal("grouptag-header");
    expect(header2.getAttribute("data-group-id")).to.equal(group2.id);
    expect(header2.children[0]?.textContent).to.equal("Group 2");
  });

  it("registers one native main/tab menu bundle with object-based MenuManager options", function (): void {
    const model = new TabGroupModel();
    const adapter = new MockTabAdapter();
    const doc = new MockDocument();
    const promptService = createPromptServiceMock();
    const menuManager = createMenuManagerMock();
    installGlobals(doc, promptService, menuManager);

    const commands = new TabGroupCommandHandler(model);
    const ui = new TabGroupUI(
      model,
      adapter,
      commands,
      doc as unknown as Document,
    );

    ui.mount();

    expect(menuManager.registeredMenus).to.have.lengthOf(1);
    expect(menuManager.registeredMenus[0]).to.deep.include({
      menuID: "grouptag-tab-actions",
      pluginID: "grouptag@zotero.org",
      target: "main/tab",
    });

    const registered = menuManager.registeredMenus[0];
    // Menu items: [0] = Assign to New Group, [1] = Remove from Group
    expect(registered.menus.length).to.be.greaterThanOrEqual(2);
    expect(registered.menus[0]).to.not.equal(undefined);
    expect(registered.menus[1]).to.not.equal(undefined);
  });

  it("creates and assigns a group from the native tab menu using stable identity", function (): void {
    const model = new TabGroupModel();
    const adapter = new MockTabAdapter();
    const doc = new MockDocument();
    const promptService = createPromptServiceMock();
    const menuManager = createMenuManagerMock();
    installGlobals(doc, promptService, menuManager);

    promptService.prompt = function (
      _window: unknown,
      _title: string,
      message: string,
      result: { value: string },
    ): boolean {
      this.promptCalls.push({ message, defaultText: result.value });
      result.value = "Research";
      return true;
    };

    const commands = new TabGroupCommandHandler(model);
    const tab = createTab("runtime-tab-1", {
      identity: {
        tabId: "runtime-tab-1",
        stableId: "library:1:key:ABC123",
        itemId: 42,
        libraryId: 1,
        key: "ABC123",
      },
    });
    adapter.tabs = [tab];

    const ui = new TabGroupUI(
      model,
      adapter,
      commands,
      doc as unknown as Document,
    );
    ui.mount();

    const registered = menuManager.registeredMenus[0];
    // Menu index 0 = "Assign to New Group"
    const createItem = registered.menus[0];

    expect(createItem).to.not.equal(undefined);
    createItem?.onCommand?.({} as Event, createMenuContext(tab));

    expect(model.groups).to.have.lengthOf(1);
    expect(model.groups[0]?.name).to.equal("Research");
    expect(model.groups[0]?.tabIds).to.deep.equal(["library:1:key:ABC123"]);
  });

  it("refreshes native menu registrations so assign-existing tracks current groups", function (): void {
    const model = new TabGroupModel();
    const adapter = new MockTabAdapter();
    const doc = new MockDocument();
    const promptService = createPromptServiceMock();
    const menuManager = createMenuManagerMock();
    installGlobals(doc, promptService, menuManager);

    model.createGroup("Alpha", "blue");
    const commands = new TabGroupCommandHandler(model);
    const ui = new TabGroupUI(
      model,
      adapter,
      commands,
      doc as unknown as Document,
    );
    ui.mount();

    model.createGroup("Beta", "green");
    ui.update();

    expect(menuManager.unregisteredMenuIDs).to.deep.equal([
      "grouptag-tab-actions",
    ]);
    expect(menuManager.registeredMenus).to.have.lengthOf(2);

    const latestRegistration = menuManager.registeredMenus[1];
    // After creating "Beta", menus should be:
    // [0] = Assign to New Group, [1] = Remove from Group,
    // [2] = Assign to: Alpha, [3] = Assign to: Beta
    expect(latestRegistration.menus.length).to.be.greaterThanOrEqual(4);
  });

  it("shows remove-from-group only for grouped reader tabs", function (): void {
    const model = new TabGroupModel();
    const adapter = new MockTabAdapter();
    const doc = new MockDocument();
    const promptService = createPromptServiceMock();
    const menuManager = createMenuManagerMock();
    installGlobals(doc, promptService, menuManager);

    const group = model.createGroup("Research", "blue");
    const groupedTab = createTab("tab-1");
    model.assignTab(group.id, groupedTab.identity.stableId);
    adapter.tabs = [groupedTab, createTab("tab-2")];

    const commands = new TabGroupCommandHandler(model);
    const ui = new TabGroupUI(
      model,
      adapter,
      commands,
      doc as unknown as Document,
    );
    ui.mount();

    // Menu index 1 = "Remove from Group"
    const removeItem = menuManager.registeredMenus[0].menus[1];
    expect(removeItem).to.not.equal(undefined);

    const groupedContext = createMenuContext(groupedTab);
    removeItem?.onShowing?.({} as Event, groupedContext);
    expect(groupedContext.menuElem.getAttribute("data-visible")).to.equal(
      "true",
    );

    const ungroupedContext = createMenuContext(createTab("tab-2"));
    removeItem?.onShowing?.({} as Event, ungroupedContext);
    expect(ungroupedContext.menuElem.getAttribute("data-visible")).to.equal(
      "false",
    );

    const libraryContext: MenuContextMock = {
      ...createMenuContext(createTab("tab-3")),
      tabType: "library",
    };
    removeItem?.onShowing?.({} as Event, libraryContext);
    expect(libraryContext.menuElem.getAttribute("data-visible")).to.equal(
      "false",
    );
  });

  it("dispatches rename from the visual group header context menu", async function (): Promise<void> {
    const model = new TabGroupModel();
    const adapter = new MockTabAdapter();
    const doc = new MockDocument();
    const promptService = createPromptServiceMock();
    const menuManager = createMenuManagerMock();
    installGlobals(doc, promptService, menuManager);

    promptService.prompt = function (
      _window: unknown,
      _title: string,
      message: string,
      result: { value: string },
    ): boolean {
      this.promptCalls.push({ message, defaultText: result.value });
      result.value = "Renamed Group";
      return true;
    };

    const group = model.createGroup("Group 1", "blue");
    model.assignTab(group.id, "tab:tab-1");
    adapter.tabs = [createTab("tab-1")];
    doc.addTabElement("tab-1");

    const commands = new TabGroupCommandHandler(model);
    const ui = new TabGroupUI(
      model,
      adapter,
      commands,
      doc as unknown as Document,
    );

    ui.mount();
    await flushRender();

    const header = doc.querySelectorAll(".grouptag-header")[0];
    expect(header).to.not.equal(undefined);

    triggerEvent(header as MockDOMElement, "contextmenu", {
      preventDefault(): void {
        return undefined;
      },
      stopPropagation(): void {
        return undefined;
      },
      screenX: 150,
      screenY: 275,
    } as unknown as Event);

    // After showGroupContextMenu, the original element is replaced with a
    // clone that has a "command" event listener (XUL menuitems don't support
    // the oncommand JS property). Look up the current element by ID.
    const renameItem = doc.getElementById("grouptag-header-rename");
    expect(renameItem).to.not.equal(null);

    triggerEvent(renameItem as MockDOMElement, "command", {} as Event);

    expect(model.getGroup(group.id)?.name).to.equal("Renamed Group");
  });
});
