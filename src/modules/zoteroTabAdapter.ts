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

export interface ZoteroItemMeta {
  readonly libraryId?: number;
  readonly key?: string;
}

export interface ZoteroTabAdapterRuntime {
  getTabs(): readonly ZoteroTabRecord[];
  getReaders(): readonly ZoteroReaderRecord[];
  subscribe?(listener: () => void): () => void;
  /**
   * Resolves an itemID to its library/key metadata. Used as a fallback when
   * tab.data only carries itemID (the common case for reader-unloaded tabs
   * after session restore).
   */
  getItemMeta?(itemId: number): ZoteroItemMeta | undefined;
}

export function createZoteroTabAdapter(
  runtime: ZoteroTabAdapterRuntime = createDefaultRuntime(),
): ZoteroTabAdapter {
  const getOpenReaderTabs = (): OpenReaderTabSnapshot[] => {
    const readersByTabId = new Map(
      runtime.getReaders().map((reader) => [reader.tabID, reader] as const),
    );

    return runtime
      .getTabs()
      .filter((tab) => isReaderTabType(tab.type))
      .flatMap((tab) => {
        const reader = readersByTabId.get(tab.id);
        // Drop tabs whose reader instance is present and explicitly non-pdf.
        // Tabs without a reader instance (type "reader-unloaded" before the
        // user activates them) are kept and assumed to be PDFs.
        if (reader && getReaderType(reader) !== "pdf") {
          return [];
        }

        return [
          {
            tabId: tab.id,
            title: tab.title || reader?._title || tab.id,
            selected: Boolean(tab.selected),
            readerType: reader ? getReaderType(reader) : "pdf",
            identity: buildIdentity(tab, reader, runtime.getItemMeta),
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

function isReaderTabType(type: string): boolean {
  // Zotero uses "reader" for an active PDF reader tab and "reader-unloaded"
  // for tabs whose reader has not been instantiated yet (the common case
  // after a restart for tabs the user has not clicked). Future variants
  // starting with "reader" should also be considered.
  return type === "reader" || type.startsWith("reader-");
}

function buildIdentity(
  tab: ZoteroTabRecord,
  reader: ZoteroReaderRecord | undefined,
  getItemMeta: ((itemId: number) => ZoteroItemMeta | undefined) | undefined,
): OpenReaderTabIdentity {
  const itemId =
    firstNumber(
      reader?.itemID,
      reader?.itemId,
      tab.data?.itemID,
      tab.data?.itemId,
    ) ?? undefined;

  // Prefer library/key sourced directly from the reader or tab.data; only
  // fall back to a Zotero.Items lookup for itemID when the cheap sources
  // are missing (e.g. reader-unloaded tabs whose tab.data only contains
  // itemID).
  let libraryId =
    firstNumber(
      reader?._item?.libraryID,
      reader?._item?.libraryId,
      tab.data?.libraryID,
      tab.data?.libraryId,
    ) ?? undefined;
  let key = firstString(reader?._item?.key, tab.data?.key);

  if ((libraryId === undefined || !key) && itemId !== undefined && getItemMeta) {
    const meta = safeGetItemMeta(getItemMeta, itemId);
    if (meta) {
      if (libraryId === undefined) libraryId = meta.libraryId;
      if (!key) key = meta.key;
    }
  }

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

function safeGetItemMeta(
  getItemMeta: (itemId: number) => ZoteroItemMeta | undefined,
  itemId: number,
): ZoteroItemMeta | undefined {
  try {
    return getItemMeta(itemId);
  } catch (_e) {
    return undefined;
  }
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
    getItemMeta(itemId: number): ZoteroItemMeta | undefined {
      const items = getGlobalObjects().Zotero?.Items;
      if (!items?.get) return undefined;
      try {
        const item = items.get(itemId);
        if (!item) return undefined;
        const libraryId =
          typeof item.libraryID === "number"
            ? item.libraryID
            : typeof item.libraryId === "number"
              ? item.libraryId
              : undefined;
        const key = typeof item.key === "string" ? item.key : undefined;
        return { libraryId, key };
      } catch (_e) {
        return undefined;
      }
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
    readonly Items?: {
      get(id: number): {
        readonly libraryID?: number;
        readonly libraryId?: number;
        readonly key?: string;
      } | null | undefined;
    };
  };
  readonly Zotero_Tabs?: {
    readonly _tabs?: unknown;
  };
}
