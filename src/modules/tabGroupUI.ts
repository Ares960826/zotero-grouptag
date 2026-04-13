import type { TabGroupModel, TabGroup } from "./tabGroupModel";
import type {
  ZoteroTabAdapter,
  OpenReaderTabSnapshot,
} from "./zoteroTabAdapter";
import type { TabGroupCommandHandler } from "./tabGroupCommands";

const GROUPTAG_PLUGIN_ID = "grouptag@zotero.org";
const GROUPTAG_TAB_MENU_ID = "grouptag-tab-actions";

interface NativeTabMenuContext {
  readonly menuElem: XULElement;
  readonly tabID: string;
  readonly tabType: string;
  readonly tabSubType?: string;
  setVisible(visible: boolean): void;
}

interface NativeMenuDefinition {
  readonly menuType: "menuitem";
  readonly onCommand?: (event: Event, context: NativeTabMenuContext) => void;
  readonly onShowing?: (event: Event, context: NativeTabMenuContext) => void;
}

interface NativeMenuOptions {
  readonly menuID: string;
  readonly pluginID: string;
  readonly target: "main/tab";
  readonly menus: NativeMenuDefinition[];
}

type NativeContextMenuPopup = XULElement & {
  openPopupAtScreen(x: number, y: number, isContextMenu: boolean): void;
};


interface NativeMenuManager {
  registerMenu(options: NativeMenuOptions): string | false;
  unregisterMenu(menuID: string): boolean;
}

interface ZoteroMainWindow {
  readonly document: Document;
}

interface ZoteroGlobal {
  readonly MenuManager?: NativeMenuManager;
  getMainWindow(): ZoteroMainWindow;
}


/**
 * Handles the Zotero 8 tab grouping UI using native APIs.
 */
export class TabGroupUI {
  private readonly _model: TabGroupModel;
  private readonly _adapter: ZoteroTabAdapter;
  private readonly _commands?: TabGroupCommandHandler;
  private readonly _document: Document;
  private _unsubscribe: (() => void) | undefined;
  private _headerElements = new Map<string, HTMLElement>();
  private _observer: MutationObserver | undefined;
  private _contextMenu: NativeContextMenuPopup | undefined;
  private _registeredMenuID: string | undefined;
  private _isRendering = false;
  private _needsRender = false;
  private _renderScheduled = false;

  constructor(
    model: TabGroupModel,
    adapter: ZoteroTabAdapter,
    commands?: TabGroupCommandHandler,
    doc?: Document,
  ) {
    this._model = model;
    this._adapter = adapter;
    this._commands = commands;
    this._document = doc ?? getGlobalDocument();
  }

  /**
   * Initializes the UI, registers native menus, and starts observing tab bar changes.
   */
  mount(): void {
    this.ensureNativeContextMenu();

    this._unsubscribe = this._adapter.subscribe((tabs) => {
      this.requestRender(tabs);
    });

    this.registerNativeMenus();
    this.setupMutationObserver();

    // Initial render
    this.requestRender(this._adapter.getOpenReaderTabs());
  }

  /**
   * Cleans up all UI modifications and observers.
   */
  unmount(): void {
    if (this._contextMenu?.parentNode) {
      this._contextMenu.parentNode.removeChild(this._contextMenu);
    }
    this._contextMenu = undefined;
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = undefined;
    }
    if (this._observer) {
      this._observer.disconnect();
      this._observer = undefined;
    }
    this.unregisterNativeMenus();
    this.clearUI();
  }

  /**
   * Forces a re-render of the UI.
   */
  update(): void {
    this.registerNativeMenus();
    this.requestRender(this._adapter.getOpenReaderTabs());
  }

  private requestRender(tabs?: readonly OpenReaderTabSnapshot[]): void {
    if (this._isRendering) {
      this._needsRender = true;
      return;
    }

    if (this._renderScheduled) {
      return;
    }

    this._renderScheduled = true;

    // setTimeout may not exist in the bootstrap sandbox — use the window's.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = this._document.defaultView as any;
    (win?.setTimeout ?? setTimeout)(() => {
      this._renderScheduled = false;
      this.render(tabs ?? this._adapter.getOpenReaderTabs());
    }, 0);
  }

  /**
   * Non-destructive render loop that injects headers into the Zotero tab bar.
   */
  private render(tabs: readonly OpenReaderTabSnapshot[]): void {
    if (this._isRendering) {
      this._needsRender = true;
      return;
    }

    const tabContainer = this._document.querySelector(
      ".tabs-wrapper .tabs",
    );
    if (!tabContainer) return;

    this._isRendering = true;

    try {
      // Track which groups we've already seen in this render pass to identify the first tab of each group
      const seenGroups = new Set<string>();
      const currentHeaders = new Set<string>();

      for (const tab of tabs) {
        const tabEl = this._document.querySelector(
          `[data-id="${tab.tabId}"]`,
        );
        if (!tabEl) continue;

        const group = this.getGroupForTab(tab);
        if (group) {
          // Apply visual group styling to the tab itself
          tabEl.setAttribute("data-group-color", group.color);
          tabEl.classList.add("grouptag-tab");

          if (!seenGroups.has(group.id)) {
            seenGroups.add(group.id);
            currentHeaders.add(group.id);

            // This is the first tab of a group. Ensure header is positioned immediately before it.
            let header = this._headerElements.get(group.id);
            if (!header) {
              header = this.createHeader(group);
              this._headerElements.set(group.id, header);
            } else {
              // Update label/color in case they changed
              this.updateHeader(header, group);
            }

            // Move header if it's not in the correct position
            if (tabEl.previousSibling !== header) {
              tabContainer.insertBefore(header, tabEl);
            }
          }
        } else {
          // Tab has no group, remove styling
          tabEl.removeAttribute("data-group-color");
          tabEl.classList.remove("grouptag-tab");
        }
      }

      // Remove headers for groups that no longer exist or have no tabs
      for (const [groupId, header] of this._headerElements.entries()) {
        if (!currentHeaders.has(groupId)) {
          if (header.parentNode) {
            header.parentNode.removeChild(header);
          }
          this._headerElements.delete(groupId);
        }
      }
    } finally {
      this._isRendering = false;
      if (this._needsRender) {
        this._needsRender = false;
        this.requestRender(this._adapter.getOpenReaderTabs());
      }
    }
  }

  private setupMutationObserver(): void {
    const tabContainer = this._document.querySelector(".tabs-wrapper .tabs");
    if (!tabContainer) return;

    // MutationObserver is a window global, not available in the bootstrap
    // sandbox's globalThis. Access it from the document's owning window.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const MObserver = (this._document.defaultView as any)
      ?.MutationObserver as typeof MutationObserver | undefined;
    if (!MObserver) return;

    this._observer = new MObserver(() => {
      // When tabs are moved or reordered in the DOM, we need to ensure headers stay attached to the first tabs.
      this.requestRender(this._adapter.getOpenReaderTabs());
    });

    this._observer.observe(tabContainer, {
      childList: true,
      subtree: false,
    });
  }

  private ensureNativeContextMenu(): void {
    const popupParent =
      this._document.getElementById("mainPopupSet") ??
      this._document.querySelector("popupset") ??
      this._document.documentElement;
    if (!popupParent) return;

    let menu = this._document.getElementById(
      "grouptag-header-context-menu",
    ) as NativeContextMenuPopup | null;
    if (!menu) {
      menu = this._document.createElementNS(
        "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
        "menupopup",
      ) as NativeContextMenuPopup;
      menu.id = "grouptag-header-context-menu";

      const renameItem = this._document.createElementNS(
        "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
        "menuitem",
      );
      renameItem.id = "grouptag-header-rename";
      renameItem.setAttribute("label", "Rename Group");
      menu.appendChild(renameItem);

      const recolorItem = this._document.createElementNS(
        "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
        "menuitem",
      );
      recolorItem.id = "grouptag-header-recolor";
      recolorItem.setAttribute("label", "Change Color");
      menu.appendChild(recolorItem);

      const deleteItem = this._document.createElementNS(
        "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
        "menuitem",
      );
      deleteItem.id = "grouptag-header-delete";
      deleteItem.setAttribute("label", "Delete Group");
      menu.appendChild(deleteItem);

      popupParent.appendChild(menu);
    }
    this._contextMenu = menu;
  }

  private registerNativeMenus(): void {
    this.unregisterNativeMenus();

    // Access MenuManager via the window's Zotero to avoid cross-compartment
    // wrapper issues with the sandbox's globalThis.Zotero.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = this._document.defaultView as any;
    const menuManager = win?.Zotero?.MenuManager as
      | NativeMenuManager
      | undefined;

    if (!menuManager || !this._commands) {
      return;
    }

    const registeredMenuID = menuManager.registerMenu({
      menuID: GROUPTAG_TAB_MENU_ID,
      pluginID: GROUPTAG_PLUGIN_ID,
      target: "main/tab",
      menus: this.buildNativeTabMenus(),
    });

    if (registeredMenuID) {
      this._registeredMenuID = registeredMenuID;
    }
  }

  private unregisterNativeMenus(): void {
    const menuManager = this.getNativeMenuManager();
    if (!menuManager || !this._registeredMenuID) {
      this._registeredMenuID = undefined;
      return;
    }

    menuManager.unregisterMenu(this._registeredMenuID);
    this._registeredMenuID = undefined;
  }

  private getNativeMenuManager(): NativeMenuManager | undefined {
    const Zotero = getOptionalZoteroGlobal();
    return Zotero?.MenuManager as NativeMenuManager | undefined;
  }

  private buildNativeTabMenus(): NativeMenuDefinition[] {
    // All callbacks are wrapped in try-catch because MenuManager invokes
    // them from the main window compartment while the closures live in
    // the bootstrap sandbox.  Cross-compartment calls to adapter/model
    // methods can throw; the fallback keeps items visible so the user
    // can still interact with them.
    return [
      {
        menuType: "menuitem",
        onShowing: (_event, context): void => {
          context.menuElem.setAttribute("label", "Assign to New Group");
          try {
            context.setVisible(this.canManageTabFromContext(context));
          } catch (_e) {
            context.setVisible(true);
          }
        },
        onCommand: (_event, context): void => {
          try {
            const snapshot = this.getSnapshotForContext(context);
            if (!snapshot || !this._commands) return;

            const name = this.promptUser("New group name:", "New Group");
            if (!name) return;

            const group = this._commands.createGroup(name);
            if (!group) return;

            this._commands.assignTab(group.id, snapshot.identity.stableId);
          } catch (_e) {
            // Cross-compartment call failed — user can retry
          }
        },
      },
      {
        menuType: "menuitem",
        onShowing: (_event, context): void => {
          context.menuElem.setAttribute("label", "Remove from Group");
          try {
            const snapshot = this.getSnapshotForContext(context);
            context.setVisible(
              !!(snapshot && this.getGroupForTab(snapshot)),
            );
          } catch (_e) {
            context.setVisible(false);
          }
        },
        onCommand: (_event, context): void => {
          try {
            const snapshot = this.getSnapshotForContext(context);
            const group = snapshot
              ? this.getGroupForTab(snapshot)
              : undefined;
            if (!snapshot || !group || !this._commands) return;

            this._commands.unassignTab(group.id, snapshot.identity.stableId);
          } catch (_e) {
            // Silently fail
          }
        },
      },
      // Each existing group gets its own top-level menuitem.
      // Zotero's MenuManager for "main/tab" does not support menuType "menu"
      // (nested submenus), so we flatten the "Assign to Group" list here.
      ...this._model.groups.map(
        (group): NativeMenuDefinition => ({
          menuType: "menuitem",
          onShowing: (_event, context): void => {
            context.menuElem.setAttribute(
              "label",
              "Assign to: " + group.name,
            );
            try {
              const snapshot = this.getSnapshotForContext(context);
              const currentGroup = snapshot
                ? this.getGroupForTab(snapshot)
                : undefined;
              context.setVisible(
                !!snapshot && currentGroup?.id !== group.id,
              );
            } catch (_e) {
              context.setVisible(true);
            }
          },
          onCommand: (_event, context): void => {
            try {
              const snapshot = this.getSnapshotForContext(context);
              if (!snapshot || !this._commands) return;

              this._commands.assignTab(
                group.id,
                snapshot.identity.stableId,
              );
            } catch (_e) {
              // Silently fail
            }
          },
        }),
      ),
    ];
  }

  private canManageTabFromContext(context: NativeTabMenuContext): boolean {
    return !!this.getSnapshotForContext(context);
  }

  private getSnapshotForContext(
    context: Pick<NativeTabMenuContext, "tabID" | "tabType">,
  ): OpenReaderTabSnapshot | undefined {
    if (context.tabType !== "reader") {
      return undefined;
    }

    return this._adapter
      .getOpenReaderTabs()
      .find((tab) => tab.tabId === context.tabID);
  }

  private getAssignableGroups(
    snapshot: OpenReaderTabSnapshot | undefined,
  ): readonly TabGroup[] {
    if (!snapshot) {
      return [];
    }

    const currentGroup = this.getGroupForTab(snapshot);
    return this._model.groups.filter((group) => group.id !== currentGroup?.id);
  }

  private clearUI(): void {
    for (const header of Array.from(this._headerElements.values())) {
      if (header.parentNode) {
        header.parentNode.removeChild(header);
      }
    }
    this._headerElements.clear();

    const styledTabs = this._document.querySelectorAll(".grouptag-tab");
    for (const tab of Array.from(styledTabs) as HTMLElement[]) {
      tab.removeAttribute("data-group-color");
      tab.classList.remove("grouptag-tab");
    }
  }

  private getGroupForTab(tab: OpenReaderTabSnapshot): TabGroup | undefined {
    return this._model.groups.find((group) =>
      group.tabIds.includes(tab.identity.stableId),
    );
  }

  private createHeader(group: TabGroup): HTMLElement {
    const header = this._document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div",
    ) as HTMLElement;
    header.className = "grouptag-header";
    header.setAttribute("data-group-id", group.id);

    const label = this._document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "span",
    );
    label.className = "grouptag-header-label";
    header.appendChild(label);

    this.updateHeader(header, group);

    header.addEventListener("contextmenu", (e: Event): void => {
      this.showGroupContextMenu(e, group.id);
    });

    return header;
  }

  private updateHeader(header: HTMLElement, group: TabGroup): void {
    header.setAttribute("data-group-color", group.color);
    const label = header.querySelector(".grouptag-header-label");
    if (label) {
      label.textContent = group.name;
    }
  }

  private showGroupContextMenu(e: Event, groupId: string): void {
    if (!this._commands || !this._contextMenu) return;
    const mouseEvt = e as MouseEvent;
    e.preventDefault();
    e.stopPropagation();

    const renameItem = this._document.getElementById(
      "grouptag-header-rename",
    );
    const recolorItem = this._document.getElementById(
      "grouptag-header-recolor",
    );
    const deleteItem = this._document.getElementById(
      "grouptag-header-delete",
    );

    // XUL menuitems don't support setting `oncommand` as a JS property.
    // Replace each element with a fresh clone to clear old listeners,
    // then use addEventListener("command", ...).
    if (renameItem) {
      const fresh = renameItem.cloneNode(true) as Element;
      renameItem.parentNode!.replaceChild(fresh, renameItem);
      fresh.addEventListener("command", () => {
        try {
          const group = this._model.groups.find((g) => g.id === groupId);
          const name = this.promptUser(
            "New name:",
            group?.name ?? "Renamed Group",
          );
          if (name) this._commands!.renameGroup(groupId, name);
        } catch (_e) {
          // Cross-compartment error
        }
      });
    }

    if (recolorItem) {
      const fresh = recolorItem.cloneNode(true) as Element;
      recolorItem.parentNode!.replaceChild(fresh, recolorItem);
      fresh.addEventListener("command", () => {
        try {
          const group = this._model.groups.find((g) => g.id === groupId);
          const color = this.promptUser(
            "Color (CSS name or #hex):",
            group?.color ?? "blue",
            (val) => {
              const s = this._document.createElement("div").style;
              s.color = val;
              return s.color !== "";
            },
          );
          if (color) this._commands!.recolorGroup(groupId, color);
        } catch (_e) {
          // Cross-compartment error
        }
      });
    }

    if (deleteItem) {
      const fresh = deleteItem.cloneNode(true) as Element;
      deleteItem.parentNode!.replaceChild(fresh, deleteItem);
      fresh.addEventListener("command", () => {
        try {
          if (this.confirmUser("Delete this group?")) {
            this._commands!.deleteGroup(groupId);
          }
        } catch (_e) {
          // Cross-compartment error
        }
      });
    }

    this._contextMenu.openPopupAtScreen(
      mouseEvt.screenX,
      mouseEvt.screenY,
      true,
    );
  }

  private promptUser(
    message: string,
    defaultText: string,
    validator?: (val: string) => boolean,
  ): string | null {
    // Use Services.prompt (Gecko global) instead of Components.classes
    // which is unavailable when callbacks run in the main window compartment.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = (this._document.defaultView as any)?.Services?.prompt
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ?? (globalThis as any).Services?.prompt;
    if (!svc) return null;

    const win = getZoteroGlobal().getMainWindow();
    let currentVal = defaultText;
    while (true) {
      const result = { value: currentVal };
      const check = { value: false };

      const ok = svc.prompt(
        win,
        "Zotero GroupTag",
        message,
        result,
        null,
        check,
      );

      if (!ok) return null;
      if (!validator || validator(result.value)) {
        return result.value;
      }

      svc.alert(win, "Zotero GroupTag", "Invalid input. Please try again.");
      currentVal = result.value;
    }
  }

  private confirmUser(message: string): boolean {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = (this._document.defaultView as any)?.Services?.prompt
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ?? (globalThis as any).Services?.prompt;
    if (!svc) return false;

    return svc.confirm(
      getZoteroGlobal().getMainWindow(),
      "Zotero GroupTag",
      message,
    );
  }
}


function getOptionalZoteroGlobal(): ZoteroGlobal | undefined {
  return (globalThis as typeof globalThis & { Zotero?: ZoteroGlobal }).Zotero;
}

function getZoteroGlobal(): ZoteroGlobal {
  const Zotero = getOptionalZoteroGlobal();
  if (!Zotero) {
    throw new Error("Zotero global is unavailable.");
  }

  return Zotero;
}

function getGlobalDocument(): Document {
  return getZoteroGlobal().getMainWindow().document;
}
