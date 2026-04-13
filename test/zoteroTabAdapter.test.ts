import { expect } from "chai";

import {
  createZoteroTabAdapter,
  type ZoteroReaderRecord,
  type ZoteroTabAdapterRuntime,
  type ZoteroTabRecord,
} from "../src/modules/zoteroTabAdapter.ts";

describe("ZoteroTabAdapter", function () {
  it("enumerates open pdf reader tabs and exposes stable identity fields", function () {
    const runtime = createRuntime({
      tabs: [
        {
          id: "tab-pdf",
          type: "reader",
          title: "Paper.pdf",
          selected: true,
          data: {
            itemID: 101,
            libraryID: 1,
            key: "ABCD1234",
          },
        },
        {
          id: "tab-epub",
          type: "reader",
          title: "Book.epub",
          selected: false,
          data: {
            itemID: 202,
          },
        },
        {
          id: "tab-library",
          type: "library",
          title: "My Library",
          selected: false,
        },
      ],
      readers: [
        {
          tabID: "tab-pdf",
          type: "pdf",
          itemID: 101,
          _item: {
            libraryID: 1,
            key: "ABCD1234",
          },
        },
        {
          tabID: "tab-epub",
          type: "epub",
          itemID: 202,
        },
      ],
    });

    const adapter = createZoteroTabAdapter(runtime);

    expect(adapter.getOpenReaderTabs()).to.deep.equal([
      {
        tabId: "tab-pdf",
        title: "Paper.pdf",
        selected: true,
        readerType: "pdf",
        identity: {
          tabId: "tab-pdf",
          stableId: "library:1:key:ABCD1234",
          itemId: 101,
          libraryId: 1,
          key: "ABCD1234",
        },
      },
    ]);
  });

  it("falls back to item identity when library key metadata is unavailable", function () {
    const runtime = createRuntime({
      tabs: [
        {
          id: "tab-pdf",
          type: "reader",
          title: "Loose Attachment.pdf",
          data: {
            itemID: 404,
          },
        },
      ],
      readers: [
        {
          tabID: "tab-pdf",
          type: "pdf",
          itemID: 404,
        },
      ],
    });

    const adapter = createZoteroTabAdapter(runtime);

    expect(adapter.getOpenReaderTabs()[0]?.identity).to.deep.equal({
      tabId: "tab-pdf",
      stableId: "item:404",
      itemId: 404,
      libraryId: undefined,
      key: undefined,
    });
  });

  it("keeps stable identity when runtime tab IDs change across restore", function () {
    const runtime = createRuntime({
      tabs: [
        {
          id: "runtime-tab-1",
          type: "reader",
          title: "Paper.pdf",
          data: {
            itemID: 101,
            libraryID: 1,
            key: "ABCD1234",
          },
        },
      ],
      readers: [
        {
          tabID: "runtime-tab-1",
          type: "pdf",
          itemID: 101,
          _item: {
            libraryID: 1,
            key: "ABCD1234",
          },
        },
      ],
    });

    const adapter = createZoteroTabAdapter(runtime);
    const first = adapter.getOpenReaderTabs()[0];

    runtime.setTabs([
      {
        id: "runtime-tab-99",
        type: "reader",
        title: "Paper.pdf",
        data: {
          itemID: 101,
          libraryID: 1,
          key: "ABCD1234",
        },
      },
    ]);
    runtime.setReaders([
      {
        tabID: "runtime-tab-99",
        type: "pdf",
        itemID: 101,
        _item: {
          libraryID: 1,
          key: "ABCD1234",
        },
      },
    ]);

    const restored = adapter.getOpenReaderTabs()[0];

    expect(first?.tabId).to.equal("runtime-tab-1");
    expect(restored?.tabId).to.equal("runtime-tab-99");
    expect(first?.identity.stableId).to.equal("library:1:key:ABCD1234");
    expect(restored?.identity.stableId).to.equal("library:1:key:ABCD1234");
  });

  it("subscribes to tab changes and stops notifying after unsubscribe", function () {
    const runtime = createRuntime({
      tabs: [
        {
          id: "tab-one",
          type: "reader",
          title: "One.pdf",
          data: { itemID: 1 },
        },
      ],
      readers: [
        {
          tabID: "tab-one",
          type: "pdf",
          itemID: 1,
        },
      ],
    });
    const adapter = createZoteroTabAdapter(runtime);
    const notifications: string[][] = [];

    const unsubscribe = adapter.subscribe((tabs) => {
      notifications.push(tabs.map((tab) => tab.identity.stableId));
    });

    runtime.setTabs([
      {
        id: "tab-one",
        type: "reader",
        title: "One.pdf",
        data: { itemID: 1 },
      },
      {
        id: "tab-two",
        type: "reader",
        title: "Two.pdf",
        data: { itemID: 2 },
      },
    ]);
    runtime.setReaders([
      {
        tabID: "tab-one",
        type: "pdf",
        itemID: 1,
      },
      {
        tabID: "tab-two",
        type: "pdf",
        itemID: 2,
      },
    ]);
    runtime.emitChange();

    unsubscribe();
    runtime.setTabs([]);
    runtime.setReaders([]);
    runtime.emitChange();

    expect(notifications).to.deep.equal([["item:1", "item:2"]]);
    expect(runtime.unsubscribeCalls).to.equal(1);
  });
});

interface MockRuntime extends ZoteroTabAdapterRuntime {
  emitChange(): void;
  setReaders(readers: readonly ZoteroReaderRecord[]): void;
  setTabs(tabs: readonly ZoteroTabRecord[]): void;
  readonly unsubscribeCalls: number;
}

function createRuntime({
  tabs,
  readers,
}: {
  tabs: readonly ZoteroTabRecord[];
  readers: readonly ZoteroReaderRecord[];
}): MockRuntime {
  let currentTabs = [...tabs];
  let currentReaders = [...readers];
  let listener: (() => void) | undefined;
  let unsubscribeCalls = 0;

  return {
    getReaders(): readonly ZoteroReaderRecord[] {
      return currentReaders;
    },
    getTabs(): readonly ZoteroTabRecord[] {
      return currentTabs;
    },
    subscribe(onChange: () => void): () => void {
      listener = onChange;

      return () => {
        unsubscribeCalls += 1;
        listener = undefined;
      };
    },
    emitChange(): void {
      listener?.();
    },
    setReaders(nextReaders: readonly ZoteroReaderRecord[]): void {
      currentReaders = [...nextReaders];
    },
    setTabs(nextTabs: readonly ZoteroTabRecord[]): void {
      currentTabs = [...nextTabs];
    },
    get unsubscribeCalls(): number {
      return unsubscribeCalls;
    },
  };
}
