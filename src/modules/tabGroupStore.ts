import type {
  ActiveTabGroupId,
  TabGroup,
  TabGroupModelSnapshot,
} from "./tabGroupModel.ts";

import { logZoteroError, toContextualError } from "./zoteroLogging.ts";

const SUPPORTED_TAB_GROUP_COLORS = [
  "blue",
  "green",
  "yellow",
  "orange",
  "red",
  "purple",
  "gray",
] as const;

export const TAB_GROUP_STORE_VERSION = 1 as const;

export type TabGroupStoreSnapshot = TabGroupModelSnapshot;

interface PersistedTabGroupStoreV1 {
  readonly version: typeof TAB_GROUP_STORE_VERSION;
  readonly groups: readonly PersistedTabGroup[];
  readonly activeGroupId?: string;
}

interface PersistedTabGroup {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly tabIds: readonly string[];
}

export function serializeTabGroupStore(
  snapshot: TabGroupStoreSnapshot,
): string {
  const normalizedSnapshot = validateSnapshot(snapshot);

  return JSON.stringify({
    version: TAB_GROUP_STORE_VERSION,
    groups: normalizedSnapshot.groups,
    activeGroupId: normalizedSnapshot.activeGroupId,
  } satisfies PersistedTabGroupStoreV1);
}

export function deserializeTabGroupStore(
  serializedSnapshot: string,
): TabGroupStoreSnapshot | undefined {
  try {
    const payload = JSON.parse(serializedSnapshot) as unknown;

    if (!isRecord(payload) || payload.version !== TAB_GROUP_STORE_VERSION) {
      return undefined;
    }

    const groups = parsePersistedGroups(payload.groups);
    if (!groups) {
      return undefined;
    }

    const activeGroupId = parseActiveGroupId(payload.activeGroupId, groups);
    if (payload.activeGroupId !== undefined && activeGroupId === undefined) {
      return undefined;
    }

    return {
      groups,
      activeGroupId,
    };
  } catch (error) {
    logZoteroError(
      toContextualError(
        "[TabGroupStore] Failed to deserialize tab group store",
        error,
      ),
    );
    return undefined;
  }
}

function validateSnapshot(
  snapshot: TabGroupStoreSnapshot,
): TabGroupStoreSnapshot {
  if (!isRecord(snapshot)) {
    throw new Error("Tab group store snapshot must be an object");
  }

  const groups = parsePersistedGroups(snapshot.groups);
  if (!groups) {
    throw new Error("Tab group store snapshot contains invalid groups");
  }

  const activeGroupId = parseActiveGroupId(snapshot.activeGroupId, groups);
  if (snapshot.activeGroupId !== undefined && activeGroupId === undefined) {
    throw new Error(
      "Tab group store snapshot references an unknown active group",
    );
  }

  return {
    groups,
    activeGroupId,
  };
}

function parsePersistedGroups(value: unknown): TabGroup[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const groups: TabGroup[] = [];
  const groupIds = new Set<string>();
  const assignedTabIds = new Set<string>();

  for (const entry of value) {
    if (!isRecord(entry)) {
      return undefined;
    }

    const id = parseIdentifier(entry.id);
    const name = parseGroupName(entry.name);
    const color = parseColor(entry.color);
    const tabIds = parseTabIds(entry.tabIds, assignedTabIds);

    if (!id || !name || !color || !tabIds || groupIds.has(id)) {
      return undefined;
    }

    groupIds.add(id);
    groups.push({
      id,
      name,
      color,
      tabIds,
    });
  }

  return groups;
}

function parseActiveGroupId(
  value: unknown,
  groups: readonly TabGroup[],
): ActiveTabGroupId {
  if (value === undefined) {
    return undefined;
  }

  const activeGroupId = parseIdentifier(value);
  if (!activeGroupId) {
    return undefined;
  }

  return groups.some((group) => group.id === activeGroupId)
    ? activeGroupId
    : undefined;
}

function parseTabIds(
  value: unknown,
  assignedTabIds: Set<string>,
): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const tabIds: string[] = [];

  for (const entry of value) {
    const tabId = parseIdentifier(entry);
    if (!tabId || assignedTabIds.has(tabId)) {
      return undefined;
    }

    assignedTabIds.add(tabId);
    tabIds.push(tabId);
  }

  return tabIds;
}

function parseColor(value: unknown): TabGroup["color"] | undefined {
  return isTabGroupColor(value) ? value : undefined;
}

function parseGroupName(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalizedName = value.trim();
  return normalizedName.length > 0 ? normalizedName : undefined;
}

function parseIdentifier(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTabGroupColor(value: unknown): value is TabGroup["color"] {
  return (
    typeof value === "string" &&
    SUPPORTED_TAB_GROUP_COLORS.includes(value as never)
  );
}
