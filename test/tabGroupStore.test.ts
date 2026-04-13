import { expect } from "chai";

import {
  TAB_GROUP_STORE_VERSION,
  deserializeTabGroupStore,
  serializeTabGroupStore,
  type TabGroupStoreSnapshot,
} from "../src/modules/tabGroupStore.ts";

describe("tabGroupStore", function () {
  it("serializes a versioned payload and restores groups with the active group", function () {
    const snapshot: TabGroupStoreSnapshot = {
      groups: [
        {
          id: "group-research",
          name: "Research",
          color: "blue",
          tabIds: ["tab-1", "tab-2"],
        },
        {
          id: "group-writing",
          name: "Writing",
          color: "green",
          tabIds: ["tab-3"],
        },
      ],
      activeGroupId: "group-writing",
    };

    const serialized = serializeTabGroupStore(snapshot);

    expect(JSON.parse(serialized)).to.deep.equal({
      version: TAB_GROUP_STORE_VERSION,
      groups: snapshot.groups,
      activeGroupId: "group-writing",
    });
    expect(deserializeTabGroupStore(serialized)).to.deep.equal(snapshot);
  });

  it("rejects malformed and corrupt payloads safely", function () {
    expect(deserializeTabGroupStore("{")).to.equal(undefined);
    expect(
      deserializeTabGroupStore(
        JSON.stringify({
          version: TAB_GROUP_STORE_VERSION,
          groups: [
            {
              id: "group-research",
              name: "Research",
              color: "magenta",
              tabIds: ["tab-1"],
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
              tabIds: ["tab-1"],
            },
            {
              id: "group-writing",
              name: "Writing",
              color: "green",
              tabIds: ["tab-1"],
            },
          ],
        }),
      ),
    ).to.equal(undefined);
  });

  it("returns undefined for corrupt payloads when Zotero global is absent", function () {
    const originalZotero = (globalThis as unknown as { Zotero?: unknown })
      .Zotero;
    delete (globalThis as unknown as { Zotero?: unknown }).Zotero;

    try {
      let result: ReturnType<typeof deserializeTabGroupStore>;

      expect(() => {
        result = deserializeTabGroupStore("{");
      }).to.not.throw();

      expect(result).to.equal(undefined);
    } finally {
      (globalThis as unknown as { Zotero?: unknown }).Zotero = originalZotero;
    }
  });

  it("rejects unknown schema versions", function () {
    expect(
      deserializeTabGroupStore(
        JSON.stringify({
          version: 999,
          groups: [],
        }),
      ),
    ).to.equal(undefined);
  });

  it("rejects payloads whose active group does not exist", function () {
    expect(
      deserializeTabGroupStore(
        JSON.stringify({
          version: TAB_GROUP_STORE_VERSION,
          groups: [
            {
              id: "group-research",
              name: "Research",
              color: "blue",
              tabIds: ["tab-1"],
            },
          ],
          activeGroupId: "missing-group",
        }),
      ),
    ).to.equal(undefined);
  });
});
