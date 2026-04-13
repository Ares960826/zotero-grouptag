export const TAB_GROUP_COLORS = [
  "blue",
  "green",
  "yellow",
  "orange",
  "red",
  "purple",
  "gray",
] as const;

export const DEFAULT_TAB_GROUP_COLOR = "blue" as const;

export type TabGroupId = string;
export type TabGroupName = string;
export type TabId = string;
export type TabGroupColor = (typeof TAB_GROUP_COLORS)[number];
export type ActiveTabGroupId = TabGroupId | undefined;

export interface TabGroup {
  readonly id: TabGroupId;
  name: TabGroupName;
  color: TabGroupColor;
  tabIds: TabId[];
}

export interface TabGroupModelSnapshot {
  readonly groups: TabGroup[];
  readonly activeGroupId: ActiveTabGroupId;
}

export class TabGroupModel {
  private _groups: Map<TabGroupId, TabGroup> = new Map();
  private _activeGroupId: ActiveTabGroupId;
  private _tabAssignments: Map<TabId, TabGroupId> = new Map();

  get groups(): TabGroup[] {
    return Array.from(this._groups.values(), (group) => this.cloneGroup(group));
  }

  get activeGroupId(): ActiveTabGroupId {
    return this._activeGroupId;
  }

  get activeGroup(): TabGroup | undefined {
    return this._activeGroupId ? this.getGroup(this._activeGroupId) : undefined;
  }

  getSnapshot(): TabGroupModelSnapshot {
    return {
      groups: this.groups,
      activeGroupId: this._activeGroupId,
    };
  }

  getGroup(groupId: TabGroupId): TabGroup | undefined {
    const group = this._groups.get(groupId);
    return group ? this.cloneGroup(group) : undefined;
  }

  replaceSnapshot(snapshot: TabGroupModelSnapshot): void {
    const nextGroups = new Map<TabGroupId, TabGroup>();
    const nextAssignments = new Map<TabId, TabGroupId>();

    for (const group of snapshot.groups) {
      const groupId = normalizeIdentifier(group.id, "Group id");
      if (nextGroups.has(groupId)) {
        throw new Error(`Duplicate group id: ${groupId}`);
      }

      const normalizedGroup: TabGroup = {
        id: groupId,
        name: normalizeGroupName(group.name),
        color: normalizeGroupColor(group.color),
        tabIds: [],
      };

      for (const tabId of group.tabIds) {
        const normalizedTabId = normalizeIdentifier(tabId, "Tab id");
        if (nextAssignments.has(normalizedTabId)) {
          throw new Error(`Duplicate tab assignment: ${normalizedTabId}`);
        }

        normalizedGroup.tabIds.push(normalizedTabId);
        nextAssignments.set(normalizedTabId, groupId);
      }

      nextGroups.set(groupId, normalizedGroup);
    }

    if (
      snapshot.activeGroupId !== undefined &&
      !nextGroups.has(snapshot.activeGroupId)
    ) {
      throw new Error(`Active group does not exist: ${snapshot.activeGroupId}`);
    }

    this._groups = nextGroups;
    this._tabAssignments = nextAssignments;
    this._activeGroupId = snapshot.activeGroupId;
  }

  createGroup(name: string, color: string = DEFAULT_TAB_GROUP_COLOR): TabGroup {
    const group: TabGroup = {
      id: crypto.randomUUID(),
      name: normalizeGroupName(name),
      color: normalizeGroupColor(color),
      tabIds: [],
    };

    this._groups.set(group.id, group);

    return this.cloneGroup(group);
  }

  renameGroup(groupId: TabGroupId, name: string): TabGroup | undefined {
    const group = this._groups.get(groupId);
    if (!group) {
      return undefined;
    }

    group.name = normalizeGroupName(name);

    return this.cloneGroup(group);
  }

  setGroupColor(groupId: TabGroupId, color: string): TabGroup | undefined {
    const group = this._groups.get(groupId);
    if (!group) {
      return undefined;
    }

    group.color = normalizeGroupColor(color);

    return this.cloneGroup(group);
  }

  deleteGroup(groupId: TabGroupId): boolean {
    const group = this._groups.get(groupId);
    if (!group) {
      return false;
    }

    for (const tabId of group.tabIds) {
      this._tabAssignments.delete(tabId);
    }

    if (this._activeGroupId === groupId) {
      this._activeGroupId = undefined;
    }

    return this._groups.delete(groupId);
  }

  setActiveGroup(groupId: TabGroupId): boolean {
    if (!this._groups.has(groupId)) {
      return false;
    }

    this._activeGroupId = groupId;

    return true;
  }

  assignTab(groupId: TabGroupId, tabId: TabId): boolean {
    const group = this._groups.get(groupId);
    if (!group || this._tabAssignments.has(tabId)) {
      return false;
    }

    group.tabIds.push(tabId);
    this._tabAssignments.set(tabId, groupId);

    return true;
  }

  unassignTab(groupId: TabGroupId, tabId: TabId): boolean {
    const group = this._groups.get(groupId);
    if (!group) {
      return false;
    }

    const tabIndex = group.tabIds.indexOf(tabId);
    if (tabIndex === -1) {
      return false;
    }

    group.tabIds.splice(tabIndex, 1);
    this._tabAssignments.delete(tabId);

    return true;
  }

  addTabToGroup(groupId: TabGroupId, tabId: TabId): boolean {
    return this.assignTab(groupId, tabId);
  }

  removeTabFromGroup(groupId: TabGroupId, tabId: TabId): boolean {
    return this.unassignTab(groupId, tabId);
  }

  private cloneGroup(group: TabGroup): TabGroup {
    return {
      ...group,
      tabIds: [...group.tabIds],
    };
  }
}

function normalizeGroupName(name: string): TabGroupName {
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error("Group name must not be empty");
  }

  return trimmedName;
}

function normalizeGroupColor(color: string): TabGroupColor {
  if (isTabGroupColor(color)) {
    return color;
  }

  throw new Error(`Unsupported group color: ${color}`);
}

function isTabGroupColor(color: string): color is TabGroupColor {
  return TAB_GROUP_COLORS.includes(color as TabGroupColor);
}

function normalizeIdentifier(value: string, label: string): string {
  const normalizedValue = value.trim();
  if (!normalizedValue) {
    throw new Error(`${label} must not be empty`);
  }

  return normalizedValue;
}
