import { expect } from "chai";
import { TabGroupModel } from "../src/modules/tabGroupModel.ts";
import { TabGroupCommandHandler } from "../src/modules/tabGroupCommands.ts";

function requireDefined<T>(value: T | undefined, label: string): T {
  expect(value, `${label} should be defined during test setup`).to.not.equal(
    undefined,
  );

  return value as T;
}

describe("TabGroupCommandHandler", function () {
  let model: TabGroupModel;
  let handler: TabGroupCommandHandler;
  let stateChanges: number;

  beforeEach(function () {
    model = new TabGroupModel();
    stateChanges = 0;
    handler = new TabGroupCommandHandler(model, () => {
      stateChanges++;
    });
  });

  it("should orchestrate create group", function () {
    const group = requireDefined(handler.createGroup("Test Group"), "group");
    expect(group.name).to.equal("Test Group");
    expect(stateChanges).to.equal(1);
    expect(model.groups).to.have.lengthOf(1);
  });

  it("should orchestrate delete group", function () {
    const group = requireDefined(handler.createGroup("Test Group"), "group");
    const result = handler.deleteGroup(group.id);
    expect(result).to.be.true;
    expect(stateChanges).to.equal(2);
    expect(model.groups).to.be.empty;
  });

  it("should orchestrate rename group", function () {
    const group = requireDefined(handler.createGroup("Test Group"), "group");
    const updated = handler.renameGroup(group.id, "New Name");
    expect(updated?.name).to.equal("New Name");
    expect(stateChanges).to.equal(2);
  });

  it("should orchestrate recolor group", function () {
    const group = requireDefined(
      handler.createGroup("Test Group", "blue"),
      "group",
    );
    const updated = handler.recolorGroup(group.id, "red");
    expect(updated?.color).to.equal("red");
    expect(stateChanges).to.equal(2);
  });

  it("should orchestrate assign tab", function () {
    const group = requireDefined(handler.createGroup("Test Group"), "group");
    const result = handler.assignTab(group.id, "tab-1");
    expect(result).to.be.true;
    expect(stateChanges).to.equal(2);
    expect(model.getGroup(group.id)?.tabIds).to.include("tab-1");
  });

  it("should orchestrate unassign tab and auto-delete empty group", function () {
    const group = requireDefined(handler.createGroup("Test Group"), "group");
    handler.assignTab(group.id, "tab-1");
    const result = handler.unassignTab(group.id, "tab-1");
    expect(result).to.be.true;
    expect(stateChanges).to.equal(3);
    // Group is auto-deleted when its last tab is removed
    expect(model.getGroup(group.id)).to.equal(undefined);
  });

  it("should not emit state change if operation fails", function () {
    const result = handler.deleteGroup("non-existent");
    expect(result).to.be.false;
    expect(stateChanges).to.equal(0);
  });

  it("returns undefined for invalid create requests when Zotero global is absent", function () {
    const originalZotero = (globalThis as unknown as { Zotero?: unknown })
      .Zotero;
    delete (globalThis as unknown as { Zotero?: unknown }).Zotero;

    try {
      let result: ReturnType<TabGroupCommandHandler["createGroup"]>;

      expect(() => {
        result = handler.createGroup("Broken", "magenta");
      }).to.not.throw();

      expect(result).to.equal(undefined);
      expect(stateChanges).to.equal(0);
    } finally {
      (globalThis as unknown as { Zotero?: unknown }).Zotero = originalZotero;
    }
  });
});
