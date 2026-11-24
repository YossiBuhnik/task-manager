// applyUpdates — the updates-*.json path.
//
// Yossi, 24/11/2026: FREEZE, do not delete.
// Before MIGRATION_DONE this is still the live write path and must keep running.
// Once migration is done, applyUpdates is a no-op: log and skip.
// Files are left untouched — not deleted, not renamed, not moved.
// Keep them as a backup for 2 weeks from the migration date.
// After that, deletion ONLY with Yossi's explicit approval at that time.
// Nothing in this file deletes a file.
//
// Signal: pass MIGRATION_DONE ("true" / true) when that property is reachable.
// If it is not, pass updatesFrozen. It defaults to off.
// Set updatesFrozen at step 6 of the migration.
"use strict";

function migrationDone(signal) {
  if (signal == null || signal === false || signal === "false" || signal === "") return false;
  if (signal === true || signal === "true") return true;
  const done = signal.MIGRATION_DONE;
  if (done === true || done === "true") return true;
  const frozen = signal.updatesFrozen;
  if (frozen === true || frozen === "true") return true;
  return false;
}

function applyUpdates(files, opts) {
  opts = opts || {};
  const list = files || [];
  const signal = opts.migrationDone != null ? opts.migrationDone : opts.signal;
  if (migrationDone(signal)) {
    const log = opts.log || function () {};
    log("applyUpdates frozen: migration done; skipping " + list.length + " file(s); left untouched");
    return { applied: false, skipped: true, files: list };
  }
  const applyFile = opts.applyFile;
  if (typeof applyFile !== "function") {
    throw new Error("applyFile is required before migration");
  }
  for (let i = 0; i < list.length; i++) applyFile(list[i], i);
  return { applied: true, skipped: false, files: list };
}

module.exports = { applyUpdates, migrationDone };
