/**
 * Zotero GroupTag bootstrap entry point.
 *
 * Based on Zotero's official Make It Red example:
 * https://github.com/zotero/make-it-red
 * https://www.zotero.org/support/dev/zotero_7_for_developers
 */

// Top-level: if this line runs, the file was parsed successfully
var _grouptag_loaded = Date.now();
try { console.error("[GroupTag] bootstrap.js parsed at", _grouptag_loaded); } catch(e) {}

var chromeHandle;

function install(data, reason) {
  try { console.error("[GroupTag] install() called"); } catch(e) {}
}

async function startup({ id, version, resourceURI, rootURI }, reason) {
  try { console.error("[GroupTag] startup() called, rootURI=" + rootURI); } catch(e) {}
  var aomStartup = Components.classes[
    "@mozilla.org/addons/addon-manager-startup;1"
  ].getService(Components.interfaces.amIAddonManagerStartup);
  var manifestURI = Services.io.newURI(rootURI + "manifest.json");
  chromeHandle = aomStartup.registerChrome(manifestURI, [
    ["content", "__addonRef__", rootURI + "content/"],
  ]);

  try {
    Services.scriptloader.loadSubScript(
      rootURI + "content/scripts/__addonRef__.js",
    );
  } catch (e) {
    Zotero.logError(e);
    dump("[GroupTag] loadSubScript failed: " + e + "\n");
    return;
  }

  if (!Zotero.__addonInstance__) {
    dump("[GroupTag] ERROR: Zotero.__addonInstance__ not set after loadSubScript\n");
    Zotero.logError(new Error("[GroupTag] Plugin hooks not registered"));
    return;
  }

  await Zotero.__addonInstance__.hooks.onStartup();

  // If the main window is already open (e.g. plugin installed at runtime or
  // fast restart), onMainWindowLoad won't fire automatically. Trigger it now.
  var win = Zotero.getMainWindow();
  if (win) {
    await Zotero.__addonInstance__.hooks.onMainWindowLoad(win);
  }
}

async function onMainWindowLoad({ window }, reason) {
  await Zotero.__addonInstance__?.hooks.onMainWindowLoad(window);
}

async function onMainWindowUnload({ window }, reason) {
  await Zotero.__addonInstance__?.hooks.onMainWindowUnload(window);
}

async function shutdown({ id, version, resourceURI, rootURI }, reason) {
  if (reason === APP_SHUTDOWN) {
    return;
  }

  await Zotero.__addonInstance__?.hooks.onShutdown();

  if (chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
  }
}

async function uninstall(data, reason) {}
