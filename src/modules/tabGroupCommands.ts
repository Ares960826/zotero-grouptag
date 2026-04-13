import type { TabGroupModel, TabGroup } from "./tabGroupModel.ts";

import { logZoteroError, toContextualError } from "./zoteroLogging.ts";

export class TabGroupCommandHandler {
  private model: TabGroupModel;
  private onStateChange?: () => void;

  constructor(model: TabGroupModel, onStateChange?: () => void) {
    this.model = model;
    this.onStateChange = onStateChange;
  }

  createGroup(name: string, color?: string): TabGroup | undefined {
    try {
      const group = this.model.createGroup(name, color);
      this.emitChange();
      return group;
    } catch (error) {
      logZoteroError(
        toContextualError(
          `[TabGroupCommands] Failed to create group '${name}'`,
          error,
        ),
      );
      return undefined;
    }
  }

  deleteGroup(groupId: string): boolean {
    const success = this.model.deleteGroup(groupId);
    if (success) {
      this.emitChange();
    }
    return success;
  }

  renameGroup(groupId: string, name: string): TabGroup | undefined {
    try {
      const group = this.model.renameGroup(groupId, name);
      if (group) {
        this.emitChange();
      }
      return group;
    } catch (error) {
      logZoteroError(
        toContextualError(
          `[TabGroupCommands] Failed to rename group '${groupId}' to '${name}'`,
          error,
        ),
      );
      return undefined;
    }
  }

  recolorGroup(groupId: string, color: string): TabGroup | undefined {
    try {
      const group = this.model.setGroupColor(groupId, color);
      if (group) {
        this.emitChange();
      }
      return group;
    } catch (error) {
      logZoteroError(
        toContextualError(
          `[TabGroupCommands] Failed to recolor group '${groupId}'`,
          error,
        ),
      );
      return undefined;
    }
  }

  assignTab(groupId: string, tabId: string): boolean {
    const success = this.model.assignTab(groupId, tabId);
    if (success) {
      this.emitChange();
    }
    return success;
  }

  unassignTab(groupId: string, tabId: string): boolean {
    const success = this.model.unassignTab(groupId, tabId);
    if (success) {
      // Auto-delete the group if it has no tabs left
      const group = this.model.groups.find((g) => g.id === groupId);
      if (group && group.tabIds.length === 0) {
        this.model.deleteGroup(groupId);
      }
      this.emitChange();
    }
    return success;
  }

  private emitChange(): void {
    if (this.onStateChange) {
      this.onStateChange();
    }
  }
}
