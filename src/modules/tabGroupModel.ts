export const TAB_GROUP_COLORS = [
  "#184D97",
  "#1888BF",
  "#34B8C5",
  "#A7D9C7",
  "#F6D081",
  "#F6E9D3",
  "#BEC7E1",
  "#457635",
  "#6B9136",
  "#97B365",
  "#DED352",
  "#F8EBBD",
  "#B1C5C9",
  "#DFC5BF",
  "#3B328C",
  "#4E3282",
  "#8E6CBB",
  "#B69CD2",
  "#A2CDF3",
  "#F8C7CE",
  "#FAE6D6",
  "#2B4D31",
  "#477724",
  "#83A152",
  "#F1B00E",
  "#F3E864",
  "#58B0DF",
  "#A9D7E6",
  "#5271AE",
  "#70ACDE",
  "#F5CC7D",
  "#FFA660",
  "#D85B59",
] as const;

const LEGACY_TAB_GROUP_COLORS = [
  "blue",
  "green",
  "yellow",
  "orange",
  "red",
  "purple",
  "gray",
] as const;

export const DEFAULT_TAB_GROUP_COLOR = "#58B0DF" as const;

export type TabGroupId = string;
export type TabGroupName = string;
export type TabId = string;
export type TabGroupColor =
  | (typeof TAB_GROUP_COLORS)[number]
  | (typeof LEGACY_TAB_GROUP_COLORS)[number];
export type ActiveTabGroupId = TabGroupId | undefined;

export interface TabGroup {
  readonly id: TabGroupId;
  name: TabGroupName;
  color: TabGroupColor;
  collapsed: boolean;
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
        collapsed: group.collapsed === true,
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
      collapsed: false,
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

  setGroupCollapsed(
    groupId: TabGroupId,
    collapsed: boolean,
  ): TabGroup | undefined {
    const group = this._groups.get(groupId);
    if (!group) {
      return undefined;
    }

    group.collapsed = collapsed;

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

export function isTabGroupColor(color: unknown): color is TabGroupColor {
  return (
    typeof color === "string" &&
    ([...TAB_GROUP_COLORS, ...LEGACY_TAB_GROUP_COLORS] as readonly string[])
      .includes(color)
  );
}

export function resolveTabGroupColor(color: TabGroupColor): string {
  const legacyColors: Record<
    (typeof LEGACY_TAB_GROUP_COLORS)[number],
    (typeof TAB_GROUP_COLORS)[number]
  > = {
    blue: "#58B0DF",
    green: "#477724",
    yellow: "#F3E864",
    orange: "#FFA660",
    red: "#D85B59",
    purple: "#8E6CBB",
    gray: "#B1C5C9",
  };

  return color in legacyColors
    ? legacyColors[color as keyof typeof legacyColors]
    : color;
}

function normalizeIdentifier(value: string, label: string): string {
  const normalizedValue = value.trim();
  if (!normalizedValue) {
    throw new Error(`${label} must not be empty`);
  }

  return normalizedValue;
}
