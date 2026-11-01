// Test driver loaded next to GroupTag in a throwaway Zotero profile. See smoke/run.py.
var OUT;
function install() {}
function uninstall() {}
function shutdown() {}
const sleep = (ms) =>
  new Promise((r) =>
    Zotero.setTimeout ? Zotero.setTimeout(r, ms) : setTimeout(r, ms),
  );
async function until(fn, ms = 8000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    try {
      const v = fn();
      if (v) return v;
    } catch (e) {
      // Not ready yet, or the message cannot be read.
    }
    await Zotero.Promise.delay(100);
  }
  return null;
}
const R = { checks: [], errors: [], info: {} };
function check(n, ok, d) {
  R.checks.push({
    name: n,
    ok: !!ok,
    detail: d === undefined ? undefined : String(d),
  });
}
async function flush() {
  await IOUtils.writeUTF8(OUT + "/results.json", JSON.stringify(R, null, 1));
}
const PREF = "extensions.zotero.grouptag.tabGroupStore";
const store = () => JSON.parse(Zotero.Prefs.get(PREF) || '{"groups":[]}');
async function shot(win, name) {
  try {
    const bmp = await win.browsingContext.currentWindowGlobal.drawSnapshot(
      null,
      1,
      "white",
    );
    const c = win.document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "canvas",
    );
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext("2d").drawImage(bmp, 0, 0);
    const b64 = c.toDataURL("image/png").split(",")[1];
    await IOUtils.write(
      OUT + "/" + name + ".png",
      Uint8Array.from(atob(b64), (x) => x.charCodeAt(0)),
    );
  } catch (e) {
    R.errors.push("shot:" + e);
  }
}
function tabEl(d, id) {
  return d.querySelector(`.tabs-wrapper .tabs [data-id="${id}"]`);
}
async function openMenu(win, id) {
  const d = win.document;
  const el = tabEl(d, id);
  const r = el.getBoundingClientRect();
  el.dispatchEvent(
    new win.MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: r.left + 5,
      clientY: r.top + 5,
      screenX: win.screenX + r.left + 5,
      screenY: win.screenY + r.top + 5,
      view: win,
    }),
  );
  const popup = await until(
    () =>
      Array.from(d.querySelectorAll("menupopup")).find(
        (p) =>
          p.state === "open" &&
          Array.from(p.children).some((c) =>
            /Assign to|Remove from Group/.test(c.getAttribute("label") || ""),
          ),
      ),
    4000,
  );
  return popup;
}
const labels = (p) =>
  Array.from(p.children)
    .filter((c) => !c.hidden && c.getAttribute("label"))
    .map((c) => c.getAttribute("label"));
async function clickMenu(win, id, label) {
  const p = await openMenu(win, id);
  if (!p) return { ok: false, labels: null };
  const l = labels(p);
  const it = Array.from(p.children).find(
    (c) => c.getAttribute("label") === label && !c.hidden,
  );
  if (it) it.doCommand();
  p.hidePopup();
  await Zotero.Promise.delay(400);
  return { ok: !!it, labels: l };
}
function stubPrompt(win, promptValue, confirmValue) {
  const real = Object.getOwnPropertyDescriptor(win, "Services");
  const calls = [];
  Object.defineProperty(win, "Services", {
    configurable: true,
    writable: true,
    value: {
      prompt: {
        prompt(p, t, m, res) {
          calls.push(m);
          res.value = promptValue;
          return true;
        },
        confirm(p, t, m) {
          calls.push(m);
          return confirmValue;
        },
        alert(p, t, m) {
          calls.push(m);
        },
      },
    },
  });
  return {
    calls,
    restore() {
      if (real) Object.defineProperty(win, "Services", real);
      else delete win.Services;
    },
  };
}
function drag(win, src, type, x, y, dt) {
  src.dispatchEvent(
    new win.DragEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      dataTransfer: dt,
      clientX: x,
      clientY: y,
      view: win,
    }),
  );
}
async function main() {
  const { AddonManager } = ChromeUtils.importESModule(
    "resource://gre/modules/AddonManager.sys.mjs",
  );
  await Zotero.uiReadyPromise;
  await Zotero.Promise.delay(1500);
  Services.console.registerListener({
    observe(m) {
      try {
        const s = String(m.message || m);
        if (
          /grouptag|tabGroup|__addonRef__/i.test(s) &&
          (m instanceof Ci.nsIScriptError
            ? !(m.flags & Ci.nsIScriptError.warningFlag)
            : true)
        )
          R.errors.push(s.slice(0, 400));
      } catch (e) {
        // Not ready yet, or the message cannot be read.
      }
    },
  });
  const win = Zotero.getMainWindow();
  const d = win.document;
  const Tabs = win.Zotero_Tabs;
  R.info.zotero = Zotero.version;
  const a = await AddonManager.getAddonByID("grouptag@zotero.org");
  R.info.addon = a && {
    version: a.version,
    isActive: a.isActive,
    appDisabled: a.appDisabled,
    isCompatible: a.isCompatible,
    blocklist: a.blocklistState,
  };
  check(
    "addon active on this Zotero",
    a && a.isActive && !a.appDisabled,
    JSON.stringify(R.info.addon),
  );
  const phase = Zotero.Prefs.get("gtharness.phase2", true) ? 2 : 1;
  R.info.phase = phase;
  if (!a || !a.isActive) {
    await flush();
    return;
  }
  check(
    "Zotero.GroupTag hooks present",
    !!(Zotero.GroupTag && Zotero.GroupTag.hooks),
  );
  check(
    "selector .tabs-wrapper .tabs",
    !!d.querySelector(".tabs-wrapper .tabs"),
  );
  check("MenuManager available", !!(win.Zotero && win.Zotero.MenuManager));
  if (phase === 2) {
    // restart persistence
    const s = store();
    R.info.storeAtRestart = s;
    const readers = await until(() => {
      const t = Tabs._tabs.filter((x) => x.type.startsWith("reader"));
      return t.length >= 3 ? t : null;
    }, 15000);
    check(
      "restart: reader tabs restored",
      readers && readers.length >= 3,
      readers && readers.map((t) => t.type).join(),
    );
    R.info.restoredTypes = readers && readers.map((t) => t.type);
    const h = await until(() => d.querySelector(".grouptag-header"), 8000);
    check("restart: group header re-rendered", !!h, h && h.textContent);
    check(
      "restart: header name kept",
      h && /Alpha/.test(h.textContent),
      h && h.textContent,
    );
    check(
      "restart: membership from prefs",
      s.groups.length >= 1 && s.groups[0].tabIds.length === 2,
      JSON.stringify(s.groups),
    );
    check(
      "restart: members decorated",
      d.querySelectorAll(".tabs-wrapper .tabs .grouptag-tab").length === 2,
    );
    await shot(win, "restart");
    await flush();
    return;
  }
  // import PDFs
  const ids = [];
  for (const n of ["A", "B", "C"]) {
    const it = await Zotero.Attachments.importFromFile({
      file: Zotero.File.pathToFile(OUT + "/pdf/" + n + ".pdf"),
      libraryID: Zotero.Libraries.userLibraryID,
    });
    await it.saveTx?.();
    ids.push(it);
  }
  const tabIds = [];
  for (const it of ids) {
    const r = await Zotero.Reader.open(it.id);
    tabIds.push(r.tabID);
    await Zotero.Promise.delay(600);
  }
  check(
    "reader tabs open",
    tabIds.length === 3 && tabIds.every((t) => tabEl(d, t)),
    tabIds.join(),
  );
  R.info.tabTypes = Tabs._tabs.map((t) => t.type);
  const [A, B, C] = tabIds;
  const sid = (i) => `library:${ids[i].libraryID}:key:${ids[i].key}`;
  // real menu flow, no seed: create a group via prompt
  let pm = stubPrompt(win, "Alpha", true);
  let r = await clickMenu(win, A, "Assign to New Group");
  pm.restore();
  check(
    "tab context menu shows Assign to New Group",
    r.ok,
    JSON.stringify(r.labels),
  );
  check(
    "prompt reached for new group",
    pm.calls.length === 1,
    pm.calls.join("|"),
  );
  let s = store();
  check(
    "create group persisted",
    s.groups.length === 1 &&
      s.groups[0].name === "Alpha" &&
      s.groups[0].tabIds[0] === sid(0),
    JSON.stringify(s.groups),
  );
  const h0 = await until(() => d.querySelector(".grouptag-header"));
  check(
    "header rendered",
    !!h0 && /Alpha/.test(h0.textContent),
    h0 && h0.textContent,
  );
  check(
    "header inside first tab",
    (h0 && h0.parentElement === tabEl(d, A)) ||
      (h0 && tabEl(d, A).contains(h0)),
  );
  r = await clickMenu(win, B, "Assign to: Alpha");
  check(
    "assign to existing group",
    r.ok && store().groups[0].tabIds.length === 2,
    JSON.stringify(store().groups[0].tabIds),
  );
  await until(() => tabEl(d, B).classList.contains("grouptag-tab"));
  check(
    "member tab decorated",
    tabEl(d, B).classList.contains("grouptag-tab") &&
      tabEl(d, B).hasAttribute("data-group-color"),
  );
  check(
    "non-member undecorated",
    !tabEl(d, C).classList.contains("grouptag-tab"),
  );
  const col = win.getComputedStyle(tabEl(d, B), "::after").backgroundColor;
  R.info.underline = col;
  await shot(win, "expanded");
  // contiguity
  Tabs.move(C, Tabs._getTab(A).tabIndex + 1);
  const fixed = await until(() => {
    const o = Tabs._tabs.map((t) => t.id);
    return Math.abs(o.indexOf(A) - o.indexOf(B)) === 1 ? o : null;
  });
  check(
    "contiguous order enforced after move",
    !!fixed,
    Tabs._tabs.map((t) => t.id).join(),
  );
  // remove+re-add
  await clickMenu(win, C, "Assign to: Alpha");
  await Zotero.Promise.delay(300);
  r = await clickMenu(win, C, "Remove from Group");
  check(
    "remove from group (non-last)",
    r.ok && store().groups[0].tabIds.length === 2,
    JSON.stringify(store().groups[0].tabIds),
  );
  await until(() => !tabEl(d, C).classList.contains("grouptag-tab"));
  // collapse
  let h = d.querySelector(".grouptag-header");
  h.click();
  await until(
    () => tabEl(d, A).getAttribute("data-group-collapsed") === "true",
  );
  check(
    "collapse attr",
    tabEl(d, A).getAttribute("data-group-collapsed") === "true" &&
      tabEl(d, B).getAttribute("data-group-collapsed") === "true",
  );
  check(
    "collapsed member hidden",
    win.getComputedStyle(tabEl(d, B)).display === "none" ||
      tabEl(d, B).getBoundingClientRect().width === 0,
    win.getComputedStyle(tabEl(d, B)).display,
  );
  check(
    "collapsed tabs stay open",
    Tabs._tabs.filter((t) => t.type.startsWith("reader")).length === 3,
  );
  check("collapsed persisted", store().groups[0].collapsed === true);
  await shot(win, "collapsed");
  // collapsed drag past C
  const order0 = Tabs._tabs.map((t) => t.id);
  h = d.querySelector(".grouptag-header");
  const cr = tabEl(d, C).getBoundingClientRect();
  const hr = h.getBoundingClientRect();
  const dt = new win.DataTransfer();
  const lastEl = [A, B, C]
    .map((i) => tabEl(d, i))
    .sort(
      (x, y) => y.getBoundingClientRect().left - x.getBoundingClientRect().left,
    )[0];
  const lr = lastEl.getBoundingClientRect();
  const gIsBeforeC = order0.indexOf(A) < order0.indexOf(C);
  const tx = gIsBeforeC ? cr.right - 3 : cr.left + 3;
  drag(win, h, "dragstart", hr.left + 3, hr.top + 3, dt);
  await Zotero.Promise.delay(100);
  drag(win, tabEl(d, C), "dragover", tx, cr.top + 5, dt);
  await Zotero.Promise.delay(100);
  check(
    "drop marker shown",
    !!d.querySelector("[data-grouptag-drop-position]"),
  );
  await shot(win, "dragging");
  drag(win, tabEl(d, C), "drop", tx, cr.top + 5, dt);
  drag(win, h, "dragend", tx, cr.top + 5, dt);
  const moved = await until(() => {
    const o = Tabs._tabs.map((t) => t.id);
    return gIsBeforeC
      ? o.indexOf(C) < o.indexOf(A) && o.indexOf(C) < o.indexOf(B)
      : o.indexOf(C) > o.indexOf(A) && o.indexOf(C) > o.indexOf(B);
  }, 4000);
  check(
    "collapsed group drag moved group",
    !!moved,
    order0.join() + " -> " + Tabs._tabs.map((t) => t.id).join(),
  );
  // expand
  await Zotero.Promise.delay(300);
  d.querySelector(".grouptag-header").click();
  await until(
    () => tabEl(d, A).getAttribute("data-group-collapsed") !== "true",
  );
  check(
    "expand",
    tabEl(d, A).getAttribute("data-group-collapsed") !== "true" &&
      store().groups[0].collapsed === false,
  );
  // header menu rename
  h = d.querySelector(".grouptag-header");
  const hrc = h.getBoundingClientRect();
  h.dispatchEvent(
    new win.MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: hrc.left + 2,
      clientY: hrc.top + 2,
      screenX: win.screenX + hrc.left,
      screenY: win.screenY + hrc.top,
      view: win,
    }),
  );
  const hm = await until(
    () =>
      Array.from(d.querySelectorAll("menupopup")).find(
        (p) =>
          p.state === "open" &&
          Array.from(p.querySelectorAll("menuitem")).some((c) =>
            /Rename/i.test(c.getAttribute("label") || ""),
          ),
      ),
    4000,
  );
  check(
    "header context menu opens",
    !!hm,
    hm &&
      Array.from(hm.querySelectorAll("menuitem"))
        .map((c) => c.getAttribute("label"))
        .join("|"),
  );
  if (hm) {
    pm = stubPrompt(win, "Alpha", true);
    const it = Array.from(hm.querySelectorAll("menuitem")).find((c) =>
      /Rename/i.test(c.getAttribute("label")),
    );
    it.doCommand();
    hm.hidePopup();
    await Zotero.Promise.delay(400);
    pm.restore();
    check(
      "rename via header menu runs",
      pm.calls.length === 1,
      pm.calls.join("|"),
    );
  }
  // Second group: last-tab prompt, recolor, delete.
  const groupNamed = (name) => store().groups.find((g) => g.name === name);
  const headerNamed = (name) =>
    Array.from(d.querySelectorAll(".grouptag-header")).find((x) =>
      x.textContent.includes(name),
    );
  const openHeaderMenu = async (header) => {
    const box = header.getBoundingClientRect();
    header.dispatchEvent(
      new win.MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: box.left + 2,
        clientY: box.top + 2,
        screenX: win.screenX + box.left + 2,
        screenY: win.screenY + box.top + 2,
        view: win,
      }),
    );
    return until(
      () =>
        d.getElementById("grouptag-header-delete")?.closest("menupopup")
          ?.state === "open",
      4000,
    );
  };
  const headerCommand = async (name, id, promptValue, confirmValue) => {
    const opened = await openHeaderMenu(headerNamed(name));
    const item = d.getElementById(id);
    const popup = item.closest("menupopup");
    const stub = stubPrompt(win, promptValue, confirmValue);
    item.doCommand();
    popup.hidePopup();
    await Zotero.Promise.delay(400);
    stub.restore();
    return { opened: !!opened, calls: stub.calls };
  };
  pm = stubPrompt(win, "Beta", true);
  await clickMenu(win, C, "Assign to New Group");
  pm.restore();
  check("second group created", groupNamed("Beta")?.tabIds.length === 1);
  await until(() => headerNamed("Beta"));

  pm = stubPrompt(win, "", false);
  await clickMenu(win, C, "Remove from Group");
  pm.restore();
  check(
    "last tab: cancel keeps empty group",
    pm.calls.length === 1 && groupNamed("Beta")?.tabIds.length === 0,
    JSON.stringify(groupNamed("Beta")),
  );
  await clickMenu(win, C, "Assign to: Beta");
  check("empty group can be reused", groupNamed("Beta")?.tabIds.length === 1);
  await until(() => headerNamed("Beta"));

  const colorBefore = groupNamed("Beta").color;
  await headerCommand("Beta", "grouptag-header-recolor", "", false);
  const swatch = await until(() =>
    Array.from(d.querySelectorAll(".grouptag-color-swatch")).find(
      (x) => x.getAttribute("data-color") !== colorBefore,
    ),
  );
  check("color palette has choices", !!swatch);
  const colorPicked = swatch?.getAttribute("data-color");
  swatch?.click();
  await Zotero.Promise.delay(400);
  check(
    "recolor persisted",
    groupNamed("Beta")?.color === colorPicked,
    `${colorBefore} -> ${groupNamed("Beta")?.color}`,
  );

  let result = await headerCommand("Beta", "grouptag-header-delete", "", false);
  check(
    "delete cancelled keeps group",
    result.calls.length === 1 && !!groupNamed("Beta"),
  );
  result = await headerCommand("Beta", "grouptag-header-delete", "", true);
  check(
    "delete removes group",
    result.calls.length === 1 && !groupNamed("Beta"),
  );
  await until(() => !headerNamed("Beta"));
  check(
    "deleted group leaves no decoration",
    !headerNamed("Beta") && !tabEl(d, C).classList.contains("grouptag-tab"),
  );

  pm = stubPrompt(win, "Gamma", true);
  await clickMenu(win, C, "Assign to New Group");
  pm.restore();
  pm = stubPrompt(win, "", true);
  await clickMenu(win, C, "Remove from Group");
  pm.restore();
  check("last tab: confirm deletes group", !groupNamed("Gamma"));

  // hot reload: decorations go, come back from prefs
  await a.disable();
  await Zotero.Promise.delay(600);
  check(
    "disable removes headers",
    d.querySelectorAll(".grouptag-header").length === 0,
  );
  check(
    "disable removes decorations",
    d.querySelectorAll(".grouptag-tab").length === 0,
  );
  const pAfter = await openMenu(win, C).catch(() => null);
  check("disable removes tab menu items", !pAfter);
  if (!pAfter) {
    win.document.querySelectorAll("menupopup").forEach((p) => {
      if (p.state === "open") p.hidePopup();
    });
  }
  await a.enable();
  const h2 = await until(() => d.querySelector(".grouptag-header"), 6000);
  check(
    "re-enable restores group",
    !!h2 && /Alpha/.test(h2.textContent),
    h2 && h2.textContent,
  );
  // One retry: the popup opened right after re-enabling failed once in about eight runs.
  let p3 = await openMenu(win, C);
  R.info.reenableFirstTry = !!p3;
  if (!p3) {
    R.info.openPopupsAtFail = Array.from(d.querySelectorAll("menupopup"))
      .filter((p) => p.state !== "closed")
      .map(
        (p) =>
          (p.id || "anon") +
          ":" +
          p.state +
          ":" +
          Array.from(p.children)
            .map((c) => c.getAttribute("label") || c.id)
            .join("|")
            .slice(0, 300),
      );
    d.querySelectorAll("menupopup").forEach((p) => {
      if (p.state !== "closed") p.hidePopup();
    });
    await Zotero.Promise.delay(1500);
    p3 = await openMenu(win, C);
  }
  R.info.reenableSecondTry = !!p3;
  check("re-enable restores tab menu", !!p3, p3 && labels(p3).join("|"));
  if (p3) {
    R.info.menuAfterReenable = labels(p3);
    p3.hidePopup();
  }
  await Zotero.Promise.delay(300);
  R.info.finalStore = store();
  Zotero.Prefs.set("gtharness.phase2", true, true);
  await Zotero.Session?.save?.();
  if (win.Zotero_Tabs && Zotero.Session)
    Zotero.Session.setLastClosedZoteroPaneState?.(null);
  await shot(win, "final");
}
async function startup({ rootURI }) {
  OUT = Services.env.get("GT_OUT");
  (async () => {
    try {
      await main();
    } catch (e) {
      R.errors.push("HARNESS:" + e + "\n" + e.stack);
    }
    R.done = true;
    await flush();
    await Zotero.Promise.delay(300);
    Zotero.Utilities.Internal.quit(false);
  })();
}
