#!/usr/bin/env bash
# Diagnostic feedback loop for the "extension popup only opens above Folyn"
# bug. Run it WHILE the dev app is running and a tool window is (supposed to
# be) open. Prints:
#   1. the [DEBUG-toolwin] probe log (Rust-side state: panel conversion,
#      level / behavior / isOnActiveSpace readback) — empty or missing means
#      the command never ran (stale binary or chain broken before Rust);
#   2. the live CGWindowList state of every Folyn window (layer, onscreen,
#      bounds) — layer 20 = Dock (panel recipe applied), 3 = Floating
#      (raise failed / not converted), 1000 = ScreenSaver (phase-1 only).
# TEMPORARY — delete together with the DEBUG-toolwin probes.
set -euo pipefail

echo "== probe log: /tmp/folyn-toolwin-debug.log =="
if [[ -f /tmp/folyn-toolwin-debug.log ]]; then
  tail -n 60 /tmp/folyn-toolwin-debug.log
else
  echo "(no probe log — the Rust command never ran: stale build, or the"
  echo " pet-panel -> main-window -> runCommand chain broke before Rust)"
fi

echo
echo "== live Folyn windows (CGWindowList, all spaces) =="
SWIFT_TMP="$(mktemp /tmp/folyn-win.XXXXXX)"
cat > "$SWIFT_TMP" <<'SWIFT'
import AppKit

let frontmost = NSWorkspace.shared.frontmostApplication?.localizedName ?? "?"
print("frontmost app: \(frontmost)")
guard let list = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] else {
    print("(CGWindowListCopyWindowInfo failed)")
    exit(0)
}
var shown = 0
for w in list {
    guard let owner = (w[kCGWindowOwnerName as String] as? String)?.lowercased(),
          owner.contains("folyn") else { continue }
    let num = (w[kCGWindowNumber as String] as? Int) ?? -1
    let layer = (w[kCGWindowLayer as String] as? Int) ?? -1
    let onscreen = (w[kCGWindowIsOnscreen as String] as? Bool) ?? false
    // kCGWindowWindowName is not exposed to pure Swift — its raw string is.
    // Requires screen-recording permission; shows "-" without it.
    let title = (w["kCGWindowName" as String] as? String) ?? "-"
    let bounds = w[kCGWindowBounds as String] ?? [:]
    print("win=\(num) layer=\(layer) onscreen=\(onscreen) title=\(title) bounds=\(bounds)")
    shown += 1
}
if shown == 0 { print("(no Folyn windows found — app not running?)") }
SWIFT
swift "$SWIFT_TMP" || echo "(swift failed — see above)"
rm -f "$SWIFT_TMP"
