export interface ZoteroTabRecord {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly selected?: boolean;
  readonly data?: {
    readonly itemID?: number;
    readonly itemId?: number;
    readonly libraryID?: number;
    readonly libraryId?: number;
    readonly key?: string;
  };
}

export interface ZoteroReaderRecord {
  readonly tabID: string;
  readonly type?: string;
  readonly itemID?: number;
  readonly itemId?: number;
  readonly _title?: string;
  readonly _item?: {
    readonly libraryID?: number;
    readonly libraryId?: number;
    readonly key?: string;
  };
}

export interface OpenReaderTabIdentity {
  readonly tabId: string;
  readonly stableId: string;
  readonly itemId: number | undefined;
  readonly libraryId: number | undefined;
  readonly key: string | undefined;
}

export interface OpenReaderTabSnapshot {
  readonly tabId: string;
  readonly title: string;
  readonly selected: boolean;
  readonly readerType: string;
  readonly identity: OpenReaderTabIdentity;
}

export type ZoteroTabChangeListener = (
  tabs: readonly OpenReaderTabSnapshot[],
) => void;

export interface ZoteroTabAdapter {
  getOpenReaderTabs(): OpenReaderTabSnapshot[];
  subscribe(listener: ZoteroTabChangeListener): () => void;
}

export interface ZoteroTabAdapterRuntime {
  getTabs(): readonly ZoteroTabRecord[];
  getReaders(): readonly ZoteroReaderRecord[];
  subscribe?(listener: () => void): () => void;
}

export function createZoteroTabAdapter(
  runtime: ZoteroTabAdapterRuntime = createDefaultRuntime(),
): ZoteroTabAdapter {
  const getOpenReaderTabs = (): OpenReaderTabSnapshot[] => {
    const readersByTabId = new Map(
      runtime
        .getReaders()
        .filter((reader) => getReaderType(reader) === "pdf")
        .map((reader) => [reader.tabID, reader]),
    );

    return runtime
      .getTabs()
      .filter((tab) => tab.type === "reader")
      .flatMap((tab) => {
        const reader = readersByTabId.get(tab.id);
        if (!reader) {
          return [];
        }

        return [
          {
            tabId: tab.id,
            title: tab.title || reader._title || tab.id,
            selected: Boolean(tab.selected),
            readerType: getReaderType(reader),
            identity: buildIdentity(tab, reader),
          },
        ];
      });
  };

  return {
    getOpenReaderTabs,
    subscribe(listener: ZoteroTabChangeListener): () => void {
      const runtimeSubscribe = runtime.subscribe;
      if (!runtimeSubscribe) {
        return () => undefined;
      }

      return runtimeSubscribe(() => {
        listener(getOpenReaderTabs());
      });
    },
  };
}

function buildIdentity(
  tab: ZoteroTabRecord,
  reader: ZoteroReaderRecord,
): OpenReaderTabIdentity {
  const itemId =
    firstNumber(
      reader.itemID,
      reader.itemId,
      tab.data?.itemID,
      tab.data?.itemId,
    ) ?? undefined;
  const libraryId =
    firstNumber(
      reader._item?.libraryID,
      reader._item?.libraryId,
      tab.data?.libraryID,
      tab.data?.libraryId,
    ) ?? undefined;
  const key = firstString(reader._item?.key, tab.data?.key);

  return {
    tabId: tab.id,
    stableId: buildStableId(tab.id, itemId, libraryId, key),
    itemId,
    libraryId,
    key,
  };
}

function buildStableId(
  tabId: string,
  itemId: number | undefined,
  libraryId: number | undefined,
  key: string | undefined,
): string {
  if (libraryId !== undefined && key) {
    return `library:${libraryId}:key:${key}`;
  }

  if (itemId !== undefined) {
    return `item:${itemId}`;
  }

  return `tab:${tabId}`;
}

function getReaderType(reader: ZoteroReaderRecord): string {
  return reader.type ?? "pdf";
}

function firstNumber(...values: Array<number | undefined>): number | undefined {
  return values.find((value) => value !== undefined);
}

function firstString(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === "string" && value.length > 0);
}

function createDefaultRuntime(): ZoteroTabAdapterRuntime {
  return {
    getTabs(): readonly ZoteroTabRecord[] {
      const globalObjects = getGlobalObjects();
      return toValuesArray(globalObjects.Zotero_Tabs?._tabs).filter(
        isZoteroTabRecord,
      );
    },
    getReaders(): readonly ZoteroReaderRecord[] {
      const globalObjects = getGlobalObjects();
      return toValuesArray(globalObjects.Zotero?.Reader?._readers).filter(
        isZoteroReaderRecord,
      );
    },
    subscribe(listener: () => void): () => void {
      const notifier = getGlobalObjects().Zotero?.Notifier;
      if (!notifier) {
        return () => undefined;
      }

      const observerId = notifier.registerObserver(
        {
          notify(_event, type): void {
            if (type === "tab") {
              listener();
            }
          },
        },
        ["tab"],
        "GroupTag.ZoteroTabAdapter",
      );

      return () => {
        notifier.unregisterObserver(observerId);
      };
    },
  };
}

function toValuesArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (value instanceof Map) {
    return Array.from(value.values());
  }

  if (isRecord(value)) {
    return Object.values(value);
  }

  return [];
}

function isZoteroReaderRecord(value: unknown): value is ZoteroReaderRecord {
  return isRecord(value) && typeof value.tabID === "string";
}

function isZoteroTabRecord(value: unknown): value is ZoteroTabRecord {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.type === "string" &&
    typeof value.title === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getGlobalObjects(): GlobalObjects {
  return globalThis as typeof globalThis & GlobalObjects;
}

interface GlobalObjects {
  readonly Zotero?: {
    readonly Notifier?: {
      registerObserver(
        ref: {
          notify(
            event: string,
            type: string,
            ids: ReadonlyArray<string | number>,
            extraData: Record<string, unknown>,
          ): void | Promise<void>;
        },
        types?: readonly string[],
        id?: string,
        priority?: number,
      ): string;
      unregisterObserver(id: string): void;
    };
    readonly Reader?: {
      readonly _readers?: unknown;
    };
  };
  readonly Zotero_Tabs?: {
    readonly _tabs?: unknown;
  };
}
