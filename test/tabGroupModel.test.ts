import { expect } from "chai";

import {
  DEFAULT_TAB_GROUP_COLOR,
  TabGroupModel,
} from "../src/modules/tabGroupModel.ts";

describe("TabGroupModel", function () {
  it("creates a group with a default color and no tabs", function () {
    const model = new TabGroupModel();

    const group = model.createGroup("Research");

    expect(group.name).to.equal("Research");
    expect(group.color).to.equal(DEFAULT_TAB_GROUP_COLOR);
    expect(group.tabIds).to.deep.equal([]);
    expect(model.groups).to.have.length(1);
  });

  it("renames a group and changes its color", function () {
    const model = new TabGroupModel();
    const group = model.createGroup("Research", "green");

    const renamedGroup = model.renameGroup(group.id, " Deep Work ");
    const recoloredGroup = model.setGroupColor(group.id, "purple");

    expect(renamedGroup?.name).to.equal("Deep Work");
    expect(recoloredGroup?.color).to.equal("purple");
  });

  it("assigns and unassigns tab ids", function () {
    const model = new TabGroupModel();
    const group = model.createGroup("Research");

    const assigned = model.assignTab(group.id, "tab-1");
    const unassigned = model.unassignTab(group.id, "tab-1");

    expect(assigned).to.be.true;
    expect(unassigned).to.be.true;
    expect(model.getGroup(group.id)?.tabIds).to.deep.equal([]);
  });

  it("rejects duplicate tab assignments", function () {
    const model = new TabGroupModel();
    const firstGroup = model.createGroup("Research");
    const secondGroup = model.createGroup("Writing");

    expect(model.assignTab(firstGroup.id, "tab-1")).to.be.true;
    expect(model.assignTab(firstGroup.id, "tab-1")).to.be.false;
    expect(model.assignTab(secondGroup.id, "tab-1")).to.be.false;
    expect(model.getGroup(firstGroup.id)?.tabIds).to.deep.equal(["tab-1"]);
    expect(model.getGroup(secondGroup.id)?.tabIds).to.deep.equal([]);
  });

  it("returns false when removing a missing tab", function () {
    const model = new TabGroupModel();
    const group = model.createGroup("Research");

    const removed = model.unassignTab(group.id, "missing-tab");

    expect(removed).to.be.false;
  });

  it("clears the active group when deleting it", function () {
    const model = new TabGroupModel();
    const group = model.createGroup("Research");

    expect(model.setActiveGroup(group.id)).to.be.true;
    expect(model.deleteGroup(group.id)).to.be.true;
    expect(model.activeGroupId).to.equal(undefined);
    expect(model.activeGroup).to.equal(undefined);
  });

  it("rejects invalid group names", function () {
    const model = new TabGroupModel();
    const group = model.createGroup("Research");

    expect(() => model.createGroup("   ")).to.throw(
      "Group name must not be empty",
    );
    expect(() => model.renameGroup(group.id, "\n\t")).to.throw(
      "Group name must not be empty",
    );
  });

  it("rejects invalid group colors", function () {
    const model = new TabGroupModel();
    const group = model.createGroup("Research");

    expect(() => model.createGroup("Writing", "magenta")).to.throw(
      "Unsupported group color",
    );
    expect(() => model.setGroupColor(group.id, "magenta")).to.throw(
      "Unsupported group color",
    );
  });

  it("replaces runtime state from a persisted snapshot", function () {
    const model = new TabGroupModel();

    model.replaceSnapshot({
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

    expect(model.getSnapshot()).to.deep.equal({
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
  });
});
