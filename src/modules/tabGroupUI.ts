import {
  TAB_GROUP_COLORS,
  resolveTabGroupColor,
  type TabGroupModel,
  type TabGroup,
  type TabGroupColor,
} from "./tabGroupModel.ts";
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
  hidePopup(): void;
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

interface GeckoPromptService {
  prompt(
    parent: unknown,
    title: string,
    message: string,
    result: { value: string },
    checkMessage: string | null,
    checkState: { value: boolean },
  ): boolean;
  alert(parent: unknown, title: string, message: string): void;
  confirm(parent: unknown, title: string, message: string): boolean;
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
  private _colorPalette: NativeContextMenuPopup | undefined;
  private _pendingColorSelection:
    | ((color: (typeof TAB_GROUP_COLORS)[number]) => void)
    | undefined;
  private _tabContainer: Element | undefined;
  private _dragInProgress = false;
  private _draggedGroupMemberTabIds: string[] | undefined;
  private _draggedGroupAnchorTabId: string | undefined;
  private _suppressNextHeaderClick = false;
  private _registeredMenuID: string | undefined;
  private _isRendering = false;
  private _needsRender = false;
  private _renderScheduled = false;
  private _menuRegistrationScheduled = false;

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
    this.ensureColorPalette();

    this._unsubscribe = this._adapter.subscribe((tabs) => {
      this.requestRender(tabs);
    });

    this.registerNativeMenus();
    this.setupMutationObserver();

    // Initial render. Notifier "tab" events will drive subsequent renders
    // as Zotero restores session tabs and the user interacts with them.
    this.requestRender();
  }

  /**
   * Cleans up all UI modifications and observers.
   */
  unmount(): void {
    if (this._contextMenu?.parentNode) {
      this._contextMenu.parentNode.removeChild(this._contextMenu);
    }
    this._contextMenu = undefined;
    if (this._colorPalette?.parentNode) {
      this._colorPalette.parentNode.removeChild(this._colorPalette);
    }
    this._colorPalette = undefined;
    this._pendingColorSelection = undefined;
    this.detachDragListeners();
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
    if (!this._menuRegistrationScheduled) {
      this._menuRegistrationScheduled = true;
      const win = this._document.defaultView;
      (win?.setTimeout ?? setTimeout)(() => {
        this._menuRegistrationScheduled = false;
        if (this._unsubscribe) {
          this.registerNativeMenus();
        }
      }, 0);
    }
    this.requestRender(this._adapter.getOpenReaderTabs());
  }

  private requestRender(_tabs?: readonly OpenReaderTabSnapshot[]): void {
    if (this._dragInProgress) {
      this._needsRender = true;
      return;
    }

    if (this._isRendering) {
      this._needsRender = true;
      return;
    }

    if (this._renderScheduled) {
      // A render is already queued; mark that another pass is needed so
      // the queued render uses the latest state on the next tick.
      this._needsRender = true;
      return;
    }

    this._renderScheduled = true;

    // setTimeout may not exist in the bootstrap sandbox — use the window's.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = this._document.defaultView as any;
    (win?.setTimeout ?? setTimeout)(() => {
      this._renderScheduled = false;
      // Always read fresh tabs at render time. The previously-passed
      // snapshot may have been captured before session restore completed.
      this.render(this._adapter.getOpenReaderTabs());
    }, 0);
  }

  /**
   * Non-destructive render loop that injects headers into the Zotero tab bar.
   */
  private render(tabs: readonly OpenReaderTabSnapshot[]): void {
    if (this._dragInProgress) {
      this._needsRender = true;
      return;
    }

    if (this._isRendering) {
      this._needsRender = true;
      return;
    }

    const tabContainer = this._document.querySelector(".tabs-wrapper .tabs");
    if (!tabContainer) return;

    this._isRendering = true;

    try {
      if (this.ensureContiguousTabOrder(tabs)) {
        this._needsRender = true;
        return;
      }

      // Track which groups we've already seen in this render pass to identify the first tab of each group
      const seenGroups = new Set<string>();
      const currentHeaders = new Set<string>();
      const renderedTabIds = new Set<string>();

      for (const tab of tabs) {
        const tabEl = this._document.querySelector(
          `[data-id="${tab.tabId}"]`,
        ) as HTMLElement | null;
        if (!tabEl) continue;
        renderedTabIds.add(tab.tabId);
        this.clearGroupLayout(tabEl);

        const group = this.getGroupForTab(tab);
        if (group) {
          const resolvedColor = resolveTabGroupColor(group.color);
          // Apply visual group styling to the tab itself
          tabEl.setAttribute("data-group-color", group.color);
          setCSSProperty(tabEl, "--group-color", resolvedColor);
          setCSSProperty(
            tabEl,
            "--group-text-color",
            getContrastingTextColor(resolvedColor),
          );
          tabEl.classList.add("grouptag-tab");
          tabEl.setAttribute("data-group-collapsed", String(group.collapsed));

          if (!seenGroups.has(group.id)) {
            seenGroups.add(group.id);
            currentHeaders.add(group.id);
            tabEl.classList.add("grouptag-group-start");
            tabEl.setAttribute("data-group-id", group.id);
            tabEl.setAttribute("data-group-name", group.name);
            tabEl.setAttribute("aria-expanded", String(!group.collapsed));

            let header = this._headerElements.get(group.id);
            if (!header) {
              header = this.createHeader(group);
              this._headerElements.set(group.id, header);
            }
            this.updateHeader(header, group);
            if (header.parentNode !== tabEl) {
              tabEl.insertBefore(header, tabEl.firstChild);
            }
          }
        } else {
          // Tab has no group, remove styling
          tabEl.removeAttribute("data-group-color");
          tabEl.classList.remove("grouptag-tab");
        }
      }

      for (const tabEl of Array.from(
        tabContainer.querySelectorAll(".grouptag-tab"),
      ) as HTMLElement[]) {
        const tabId = tabEl.getAttribute("data-id");
        if (!tabId || !renderedTabIds.has(tabId)) {
          this.clearTabGroupState(tabEl);
        }
      }

      for (const [groupId, header] of this._headerElements.entries()) {
        if (!currentHeaders.has(groupId)) {
          header.parentNode?.removeChild(header);
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
    if (!tabContainer) {
      // Tab container is created asynchronously during main-window load.
      // Retry shortly so observer attaches once the strip exists.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const win = this._document.defaultView as any;
      const setTimeoutFn = win?.setTimeout ?? setTimeout;
      setTimeoutFn(() => {
        if (!this._observer && this._unsubscribe) {
          this.setupMutationObserver();
        }
      }, 250);
      return;
    }

    this.attachDragListeners(tabContainer);

    // MutationObserver is a window global, not available in the bootstrap
    // sandbox's globalThis. Access it from the document's owning window.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const MObserver = (this._document.defaultView as any)?.MutationObserver as
      | typeof MutationObserver
      | undefined;
    if (!MObserver) return;

    this._observer = new MObserver(() => {
      this.requestRender();
    });

    // Watch tab additions/reorder. The Notifier "tab" event handles
    // selection changes and reader load events.
    this._observer.observe(tabContainer, {
      childList: true,
      subtree: false,
    });
  }

  private attachDragListeners(tabContainer: Element): void {
    if (this._tabContainer === tabContainer) return;

    this.detachDragListeners();
    this._tabContainer = tabContainer;
    tabContainer.addEventListener("dragstart", this.handleTabDragStart);
    tabContainer.addEventListener("dragend", this.handleTabDragEnd);
  }

  private detachDragListeners(): void {
    this._tabContainer?.removeEventListener(
      "dragstart",
      this.handleTabDragStart,
    );
    this._tabContainer?.removeEventListener("dragend", this.handleTabDragEnd);
    this._tabContainer = undefined;
    this._dragInProgress = false;
    this._draggedGroupMemberTabIds = undefined;
    this._draggedGroupAnchorTabId = undefined;
  }

  private readonly handleTabDragStart = (event: Event): void => {
    this._dragInProgress = true;
    this._draggedGroupMemberTabIds = undefined;
    this._draggedGroupAnchorTabId = undefined;

    const tab = this.findContainingTab(event.target);
    if (
      !tab ||
      tab.getAttribute("data-group-collapsed") !== "true" ||
      !tab.classList.contains("grouptag-group-start")
    ) {
      return;
    }

    const groupId = tab.getAttribute("data-group-id");
    const anchorTabId = tab.getAttribute("data-id");
    const group = groupId ? this._model.getGroup(groupId) : undefined;
    if (!group || !anchorTabId) return;

    const stableIds = new Set(group.tabIds);
    const memberTabIds = this._adapter
      .getOpenReaderTabs()
      .filter((snapshot) => stableIds.has(snapshot.identity.stableId))
      .map((snapshot) => snapshot.tabId);
    const currentOrder = this._adapter.getTabOrder?.() ?? memberTabIds;

    this._draggedGroupMemberTabIds = currentOrder.filter((tabId) =>
      memberTabIds.includes(tabId),
    );
    this._draggedGroupAnchorTabId = anchorTabId;
    this._suppressNextHeaderClick = true;
  };

  private readonly handleTabDragEnd = (): void => {
    this.normalizeDraggedCollapsedGroup();
    this._dragInProgress = false;
    this._draggedGroupMemberTabIds = undefined;
    this._draggedGroupAnchorTabId = undefined;
    this._needsRender = false;
    this.requestRender();

    const win = this._document.defaultView;
    (win?.setTimeout ?? setTimeout)(() => {
      this._suppressNextHeaderClick = false;
    }, 0);
  };

  private findContainingTab(target: EventTarget | null): Element | undefined {
    let element = target as Element | null;
    while (element && element !== this._tabContainer) {
      if (element.getAttribute?.("data-id")) {
        return element;
      }
      element = element.parentNode as Element | null;
    }
    return undefined;
  }

  private normalizeDraggedCollapsedGroup(): boolean {
    const currentOrder = this._adapter.getTabOrder?.();
    const members = this._draggedGroupMemberTabIds;
    const anchorTabId = this._draggedGroupAnchorTabId;
    if (!currentOrder || !members?.length || !anchorTabId) return false;

    const anchorIndex = currentOrder.indexOf(anchorTabId);
    if (anchorIndex === -1) return false;

    const memberSet = new Set(members);
    const insertionIndex = currentOrder
      .slice(0, anchorIndex)
      .filter((tabId) => !memberSet.has(tabId)).length;
    const ungroupedOrder = currentOrder.filter(
      (tabId) => !memberSet.has(tabId),
    );
    const desiredOrder = [
      ...ungroupedOrder.slice(0, insertionIndex),
      ...members,
      ...ungroupedOrder.slice(insertionIndex),
    ];

    if (desiredOrder.every((tabId, index) => currentOrder[index] === tabId)) {
      return false;
    }

    this._adapter.reorderTabs?.(desiredOrder);
    return true;
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

      const collapseItem = this._document.createElementNS(
        "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
        "menuitem",
      );
      collapseItem.id = "grouptag-header-collapse";
      collapseItem.setAttribute("label", "Collapse Group");
      menu.appendChild(collapseItem);

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

  private ensureColorPalette(): void {
    const popupParent =
      this._document.getElementById("mainPopupSet") ??
      this._document.querySelector("popupset") ??
      this._document.documentElement;
    if (!popupParent) return;

    let palette = this._document.getElementById(
      "grouptag-color-palette",
    ) as NativeContextMenuPopup | null;
    if (!palette) {
      palette = this._document.createElementNS(
        "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
        "panel",
      ) as NativeContextMenuPopup;
      palette.id = "grouptag-color-palette";
      palette.className = "grouptag-color-palette";
      palette.setAttribute("type", "arrow");
      palette.setAttribute("orient", "vertical");

      const grid = this._document.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "div",
      ) as HTMLElement;
      grid.className = "grouptag-color-grid";
      grid.setAttribute("role", "listbox");
      grid.setAttribute("aria-label", "Group color");

      for (const color of TAB_GROUP_COLORS) {
        const swatch = this._document.createElementNS(
          "http://www.w3.org/1999/xhtml",
          "button",
        ) as HTMLElement;
        swatch.className = "grouptag-color-swatch";
        swatch.setAttribute("type", "button");
        swatch.setAttribute("data-color", color);
        swatch.setAttribute("title", color);
        swatch.setAttribute("aria-label", color);
        setCSSProperty(swatch, "--swatch-color", color);
        swatch.addEventListener("click", (event: Event): void => {
          event.preventDefault();
          event.stopPropagation();
          const callback = this._pendingColorSelection;
          this._pendingColorSelection = undefined;
          callback?.(color);
          this._colorPalette?.hidePopup();
        });
        grid.appendChild(swatch);
      }

      palette.appendChild(grid);
      palette.addEventListener("popuphidden", (): void => {
        this._pendingColorSelection = undefined;
      });
      popupParent.appendChild(palette);
    }

    this._colorPalette = palette;
  }

  private showColorPalette(
    event: Event,
    currentColor: TabGroupColor,
    onSelect: (color: (typeof TAB_GROUP_COLORS)[number]) => void,
  ): void {
    if (!this._colorPalette) return;

    const selectedColor = resolveTabGroupColor(currentColor);
    for (const swatch of Array.from(
      this._colorPalette.querySelectorAll(".grouptag-color-swatch"),
    ) as HTMLElement[]) {
      swatch.setAttribute(
        "aria-selected",
        String(swatch.getAttribute("data-color") === selectedColor),
      );
    }

    this._pendingColorSelection = onSelect;
    const mouseEvent = event as MouseEvent;
    const win = this._document.defaultView;
    const x =
      Number.isFinite(mouseEvent.screenX) && mouseEvent.screenX > 0
        ? mouseEvent.screenX
        : (win?.screenX ?? 0) + Math.max(120, (win?.innerWidth ?? 480) / 2);
    const y =
      Number.isFinite(mouseEvent.screenY) && mouseEvent.screenY > 0
        ? mouseEvent.screenY
        : (win?.screenY ?? 0) + Math.max(120, (win?.innerHeight ?? 360) / 2);
    this._colorPalette.openPopupAtScreen(x, y, false);
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
          } catch {
            context.setVisible(true);
          }
        },
        onCommand: (event, context): void => {
          try {
            const snapshot = this.getSnapshotForContext(context);
            if (!snapshot || !this._commands) return;

            const name = this.promptUser("New group name:", "New Group");
            if (!name) return;

            this.showColorPalette(event, "#58B0DF", (color): void => {
              const group = this._commands?.createGroup(name, color);
              if (!group) return;
              this._commands?.assignTab(
                group.id,
                snapshot.identity.stableId,
              );
            });
          } catch {
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
            context.setVisible(!!(snapshot && this.getGroupForTab(snapshot)));
          } catch {
            context.setVisible(false);
          }
        },
        onCommand: (_event, context): void => {
          try {
            const snapshot = this.getSnapshotForContext(context);
            const group = snapshot ? this.getGroupForTab(snapshot) : undefined;
            if (!snapshot || !group || !this._commands) return;

            const deleteEmptyGroup =
              group.tabIds.length === 1 &&
              this.confirmUser(
                "This is the last tab in the group. Select OK to delete the group, or Cancel to keep the empty group for later use.",
              );
            this._commands.unassignTab(
              group.id,
              snapshot.identity.stableId,
              deleteEmptyGroup,
            );
          } catch {
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
            context.menuElem.setAttribute("label", "Assign to: " + group.name);
            try {
              const snapshot = this.getSnapshotForContext(context);
              const currentGroup = snapshot
                ? this.getGroupForTab(snapshot)
                : undefined;
              context.setVisible(!!snapshot && currentGroup?.id !== group.id);
            } catch {
              context.setVisible(true);
            }
          },
          onCommand: (_event, context): void => {
            try {
              const snapshot = this.getSnapshotForContext(context);
              if (!snapshot || !this._commands) return;

              this._commands.assignTab(group.id, snapshot.identity.stableId);
            } catch {
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
    if (
      context.tabType !== "reader" &&
      !context.tabType.startsWith("reader-")
    ) {
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
    for (const header of this._headerElements.values()) {
      header.parentNode?.removeChild(header);
    }
    this._headerElements.clear();

    const styledTabs = this._document.querySelectorAll(".grouptag-tab");
    for (const tab of Array.from(styledTabs) as HTMLElement[]) {
      this.clearTabGroupState(tab);
    }
  }

  private getGroupForTab(tab: OpenReaderTabSnapshot): TabGroup | undefined {
    return this._model.groups.find((group) =>
      group.tabIds.includes(tab.identity.stableId),
    );
  }

  private ensureContiguousTabOrder(
    tabs: readonly OpenReaderTabSnapshot[],
  ): boolean {
    const currentOrder = this._adapter.getTabOrder?.();
    if (!currentOrder || !this._adapter.reorderTabs) {
      return false;
    }

    const groupsByTabId = new Map<string, string>();
    for (const tab of tabs) {
      const group = this.getGroupForTab(tab);
      if (!group) continue;

      groupsByTabId.set(tab.tabId, group.id);
    }

    const membersByGroup = new Map<string, string[]>();
    for (const tabId of currentOrder) {
      const groupId = groupsByTabId.get(tabId);
      if (!groupId) continue;
      const members = membersByGroup.get(groupId) ?? [];
      members.push(tabId);
      membersByGroup.set(groupId, members);
    }

    const emittedGroups = new Set<string>();
    const desiredOrder: string[] = [];
    for (const tabId of currentOrder) {
      const groupId = groupsByTabId.get(tabId);
      if (!groupId) {
        desiredOrder.push(tabId);
        continue;
      }

      if (!emittedGroups.has(groupId)) {
        emittedGroups.add(groupId);
        desiredOrder.push(...(membersByGroup.get(groupId) ?? []));
      }
    }

    if (
      desiredOrder.length === currentOrder.length &&
      desiredOrder.every((tabId, index) => currentOrder[index] === tabId)
    ) {
      return false;
    }

    this._adapter.reorderTabs(desiredOrder);
    return true;
  }

  private clearGroupLayout(tab: HTMLElement): void {
    tab.classList.remove("grouptag-group-start");
    tab.removeAttribute("data-group-id");
    tab.removeAttribute("data-group-name");
    tab.removeAttribute("data-group-collapsed");
    tab.removeAttribute("aria-expanded");
  }

  private clearTabGroupState(tab: HTMLElement): void {
    this.clearGroupLayout(tab);
    tab.removeAttribute("data-group-color");
    removeCSSProperty(tab, "--group-color");
    removeCSSProperty(tab, "--group-text-color");
    tab.classList.remove("grouptag-tab");
  }

  private createHeader(group: TabGroup): HTMLElement {
    const header = this._document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "span",
    ) as HTMLElement;
    header.className = "grouptag-header";
    header.setAttribute("draggable", "false");

    const stopEvent = (event: Event): void => {
      event.preventDefault();
      event.stopPropagation();
    };
    const stopExpandedGroupDrag = (event: Event): void => {
      if (!this._model.getGroup(group.id)?.collapsed) {
        stopEvent(event);
      }
    };
    header.addEventListener("mousedown", stopExpandedGroupDrag);
    header.addEventListener("dragstart", stopExpandedGroupDrag);
    header.addEventListener("click", (event: Event): void => {
      stopEvent(event);
      if (this._suppressNextHeaderClick) {
        this._suppressNextHeaderClick = false;
        return;
      }
      this._commands?.toggleGroupCollapsed(group.id);
    });
    header.addEventListener("contextmenu", (event: Event): void => {
      stopEvent(event);
      this.showGroupContextMenu(event, group.id);
    });

    return header;
  }

  private updateHeader(header: HTMLElement, group: TabGroup): void {
    header.setAttribute("data-group-color", group.color);
    header.setAttribute("data-group-collapsed", String(group.collapsed));
    header.setAttribute("aria-expanded", String(!group.collapsed));
    header.textContent = `${group.collapsed ? "▸" : "▾"} ${group.name}`;
  }

  private showGroupContextMenu(e: Event, groupId: string): void {
    if (!this._commands || !this._contextMenu) return;
    const mouseEvt = e as MouseEvent;
    e.preventDefault();
    e.stopPropagation();

    const renameItem = this._document.getElementById("grouptag-header-rename");
    const recolorItem = this._document.getElementById(
      "grouptag-header-recolor",
    );
    const collapseItem = this._document.getElementById(
      "grouptag-header-collapse",
    );
    const deleteItem = this._document.getElementById("grouptag-header-delete");

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
        } catch {
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
          if (!group) return;
          this.showColorPalette(e, group.color, (color): void => {
            this._commands?.recolorGroup(groupId, color);
          });
        } catch {
          // Cross-compartment error
        }
      });
    }

    if (collapseItem) {
      const group = this._model.getGroup(groupId);
      const fresh = collapseItem.cloneNode(true) as Element;
      collapseItem.parentNode!.replaceChild(fresh, collapseItem);
      fresh.setAttribute(
        "label",
        group?.collapsed ? "Expand Group" : "Collapse Group",
      );
      fresh.addEventListener("command", () => {
        try {
          this._commands!.toggleGroupCollapsed(groupId);
        } catch {
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
        } catch {
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
    const svc = this.getPromptService();
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
    const svc = this.getPromptService();
    if (!svc) return false;

    return svc.confirm(
      getZoteroGlobal().getMainWindow(),
      "Zotero GroupTag",
      message,
    );
  }

  private getPromptService(): GeckoPromptService | undefined {
    const windowWithServices = this._document.defaultView as
      | (Window & { Services?: { prompt?: GeckoPromptService } })
      | null;
    const globalsWithServices = globalThis as typeof globalThis & {
      Services?: { prompt?: GeckoPromptService };
    };

    return (
      windowWithServices?.Services?.prompt ??
      globalsWithServices.Services?.prompt
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

function getContrastingTextColor(hexColor: string): "#202124" | "#FFFFFF" {
  const red = Number.parseInt(hexColor.slice(1, 3), 16);
  const green = Number.parseInt(hexColor.slice(3, 5), 16);
  const blue = Number.parseInt(hexColor.slice(5, 7), 16);
  const luminance = (red * 299 + green * 587 + blue * 114) / 1000;
  return luminance > 165 ? "#202124" : "#FFFFFF";
}

function setCSSProperty(
  element: HTMLElement,
  property: string,
  value: string,
): void {
  const style = (element as HTMLElement & { style?: CSSStyleDeclaration })
    .style;
  if (style?.setProperty) {
    style.setProperty(property, value);
    return;
  }

  element.setAttribute("style", `${property}: ${value};`);
}

function removeCSSProperty(element: HTMLElement, property: string): void {
  const style = (element as HTMLElement & { style?: CSSStyleDeclaration })
    .style;
  style?.removeProperty?.(property);
}
