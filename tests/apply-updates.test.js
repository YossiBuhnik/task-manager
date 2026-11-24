// Run: node tests/apply-updates.test.js
"use strict";

const { applyUpdates } = require("../apply-updates.js");

let failed = 0;
let passed = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; console.log("  ok  " + name); }
  else { failed++; console.log("  FAIL " + name + "\n       got:      " + a + "\n       expected: " + e); }
}
function is(name, cond) { eq(name, !!cond, true); }

const files = [
  { name: "updates-2026-11-24.json", body: "{\"addTasks\":[]}" },
  { name: "updates-2026-11-24-b.json", body: "{\"markDone\":[\"t_1\"]}" },
];
const before = JSON.parse(JSON.stringify(files));

console.log("pre-migration");
const applied = [];
const live = applyUpdates(files, {
  migrationDone: "false",
  applyFile: (file) => applied.push(file.name),
});
is("pre-migration applies", live.applied === true && live.skipped === false);
eq("pre-migration files", applied, ["updates-2026-11-24.json", "updates-2026-11-24-b.json"]);
eq("pre-migration leaves the list", files, before);

console.log("post-migration MIGRATION_DONE");
let calls = 0;
const logs = [];
const frozen = applyUpdates(files, {
  migrationDone: "true",
  applyFile: () => { calls++; },
  log: (m) => logs.push(m),
});
is("post-migration skips", frozen.skipped === true && frozen.applied === false);
eq("post-migration does not apply", calls, 0);
eq("files intact", files, before);
is("log mentions skip", logs[0].indexOf("skipping") !== -1 && logs[0].indexOf("untouched") !== -1);

console.log("updatesFrozen flag, default off");
const off = applyUpdates(files, { signal: {}, applyFile: () => applied.push("default") });
is("default flag still applies", off.applied === true);
const flagged = applyUpdates(files, {
  signal: { updatesFrozen: true },
  applyFile: () => { throw new Error("should not apply"); },
});
is("updatesFrozen skips", flagged.skipped === true);
eq("updatesFrozen files intact", files, before);

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
