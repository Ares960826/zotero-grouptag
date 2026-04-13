import {
  createPluginRuntime,
  type PluginRuntime,
} from "./runtime/pluginRuntime";

let pluginRuntime: PluginRuntime | undefined;

export function onStartup(): void {
  dump("[GroupTag] Plugin started\n");
}

export function onMainWindowLoad(win?: Window): void {
  try {
    if (pluginRuntime) {
      return;
    }

    pluginRuntime = createPluginRuntime({ window: win });
  } catch (error) {
    pluginRuntime = undefined;
    const err = toError(error);
    logError("Failed to initialize plugin runtime", err);
  }
}

export function onShutdown(): void {
  try {
    pluginRuntime?.dispose();
  } catch (error) {
    logError("Failed to dispose plugin runtime", toError(error));
  } finally {
    pluginRuntime = undefined;
    dump("[GroupTag] Plugin shut down\n");
  }
}

export function logError(message: string, error?: Error): void {
  const errorMsg = error ? `${message}: ${error.message}` : message;
  const errorObj = new Error(errorMsg);
  if (error?.stack) {
    errorObj.stack = error.stack;
  }
  Zotero.logError(errorObj);
}

function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}
