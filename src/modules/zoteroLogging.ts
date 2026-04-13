interface ZoteroLike {
  logError?: (error: unknown) => void;
}

export function logZoteroError(error: Error): void {
  const zotero = (globalThis as { Zotero?: ZoteroLike }).Zotero;

  if (typeof zotero?.logError === "function") {
    zotero.logError(error);
  }
}

export function toContextualError(message: string, error: unknown): Error {
  const errorMessage = `${message}: ${String(error)}`;
  const contextualError = new Error(errorMessage);

  if (error instanceof Error && error.stack) {
    contextualError.stack = error.stack;
  }

  return contextualError;
}
