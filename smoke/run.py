#!/usr/bin/env python3
"""Run GroupTag through a real Zotero in a throwaway profile and data directory.

Usage: ZOTERO_PLUGIN_ZOTERO_BIN_PATH=/path/to/zotero python3 smoke/run.py [xpi]
Writes results and screenshots to .scaffold/smoke/. Exits non-zero on failure.
It never touches the user's own Zotero profile or library.
"""

import json
import os
import pathlib
import shutil
import subprocess
import sys
import time
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
HARNESS = ROOT / "smoke/harness"
OUT = ROOT / ".scaffold/smoke"
TIMEOUT_SECONDS = 180


def make_pdf(text):
    content = f"BT /F1 24 Tf 100 700 Td (Paper {text}) Tj ET".encode()
    objects = [
        b"<</Type/Catalog/Pages 2 0 R>>",
        b"<</Type/Pages/Kids[3 0 R]/Count 1>>",
        b"<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]"
        b"/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>",
        b"<</Length %d>>\nstream\n%s\nendstream" % (len(content), content),
        b"<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
    ]
    pdf, offsets = b"%PDF-1.4\n", []
    for number, body in enumerate(objects, 1):
        offsets.append(len(pdf))
        pdf += b"%d 0 obj\n%s\nendobj\n" % (number, body)
    xref = len(pdf)
    pdf += b"xref\n0 6\n0000000000 65535 f \n"
    pdf += b"".join(b"%010d 00000 n \n" % offset for offset in offsets)
    return pdf + b"trailer<</Size 6/Root 1 0 R>>\nstartxref\n%d\n%%%%EOF\n" % xref


def prepare(xpi):
    shutil.rmtree(OUT, ignore_errors=True)
    profile = OUT / "profile"
    (profile / "extensions").mkdir(parents=True)
    (OUT / "data").mkdir()
    (OUT / "pdf").mkdir()
    for name in "ABC":
        (OUT / "pdf" / f"{name}.pdf").write_bytes(make_pdf(name))
    shutil.copy(xpi, profile / "extensions/grouptag@zotero.org.xpi")
    with zipfile.ZipFile(profile / "extensions/gt-harness@test.local.xpi", "w") as z:
        for name in ("manifest.json", "bootstrap.js"):
            z.write(HARNESS / name, name)
    prefs = {
        "extensions.autoDisableScopes": 0,
        "extensions.enableScopes": 15,
        "extensions.startupScanScopes": 15,
        "xpinstall.signatures.required": False,
        "extensions.update.enabled": False,
        "app.update.enabled": False,
        "app.update.auto": False,
        "extensions.zotero.useDataDir": True,
        "extensions.zotero.dataDir": str(OUT / "data"),
        "extensions.zotero.lastDataDir": str(OUT / "data"),
        "extensions.zotero.firstRun2": False,
        "extensions.zotero.sync.autoSync": False,
        "extensions.zotero.automaticScraperUpdates": False,
    }
    (profile / "prefs.js").write_text(
        "".join(f"user_pref({json.dumps(k)}, {json.dumps(v)});\n" for k, v in prefs.items())
    )
    return profile


def run_phase(binary, profile, phase):
    results = OUT / "results.json"
    results.unlink(missing_ok=True)
    env = dict(os.environ, GT_OUT=str(OUT), MOZ_NO_REMOTE="1")
    with open(OUT / f"zotero-{phase}.log", "w") as log:
        process = subprocess.Popen(
            [binary, "-no-remote", "-profile", str(profile)],
            env=env, stdout=log, stderr=log,
        )
        try:
            process.wait(TIMEOUT_SECONDS)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
            print(f"{phase}: Zotero killed after {TIMEOUT_SECONDS}s")
    if not results.exists():
        print(f"{phase}: no results written")
        return False
    report = json.loads(results.read_text())
    (OUT / f"results-{phase}.json").write_text(json.dumps(report, indent=1))
    print(f"{phase}: Zotero {report['info'].get('zotero')}, addon {report['info'].get('addon')}")
    for check in report["checks"]:
        detail = f" -- {check['detail'][:240]}" if check.get("detail") and not check["ok"] else ""
        print(f"  {'PASS' if check['ok'] else 'FAIL'} {check['name']}{detail}")
    for error in report["errors"]:
        print(f"  ERROR {error}")
    return bool(
        report.get("done") and report["checks"]
        and all(check["ok"] for check in report["checks"])
        and not report["errors"]
    )


def main():
    binary = os.environ.get("ZOTERO_PLUGIN_ZOTERO_BIN_PATH")
    if not binary:
        sys.exit("Set ZOTERO_PLUGIN_ZOTERO_BIN_PATH to the Zotero binary")
    xpi = sys.argv[1] if len(sys.argv) > 1 else ROOT / ".scaffold/build/zotero-grouptag.xpi"
    profile = prepare(xpi)
    passed = run_phase(binary, profile, "first-run")
    passed = run_phase(binary, profile, "restart") and passed
    print("SMOKE PASSED" if passed else "SMOKE FAILED")
    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()
