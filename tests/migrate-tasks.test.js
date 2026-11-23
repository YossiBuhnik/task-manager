// Tiny no-dependency tests for PR3 migrate-tasks.js
// Run: node tests/migrate-tasks.test.js
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const M = require("../migrate-tasks.js");

const FIXTURE = path.join(__dirname, "fixtures", "migrate-sample.json");

let failed = 0;
let passed = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; console.log("  ok  " + name); }
  else { failed++; console.log("  FAIL " + name + "\n       got:      " + a + "\n       expected: " + e); }
}
function is(name, cond) { eq(name, !!cond, true); }

async function main() {
  console.log("fixture + plan");
  is("fixture exists", fs.existsSync(FIXTURE));
  const raw = fs.readFileSync(FIXTURE, "utf8");
  const state = M.unwrapState(JSON.parse(raw));
  const plan = M.planMigration(state, { asOf: "2026-11-23" });
  eq("20 tasks planned", plan.docs.length, 20);
  eq("input count", plan.inputTaskCount, 20);
  eq("status distribution", plan.status, { todo: 8, doing: 2, done: 10 });
  eq("priority distribution", plan.priority, { high: 5, mid: 13, low: 2 });
  eq("missing createdAt inferred", plan.missingCreatedAt, 4);
  is("some durations mapped", plan.durationMapped >= 3);
  eq("errors", plan.errors.length, 0);
  is("all ids preserved", plan.docs.every((d, i) => d.id === "t_" + String(i).padStart(2, "0")));
  is("all awaitingReview false", plan.docs.every((d) => d.awaitingReview === false));
  is("source empty for existing", plan.docs.every((d) => d.source === ""));
  const inferred = plan.docs.filter((d) => d.createdAtInferred);
  eq("inferred count", inferred.length, 4);
  is("inferred date is as-of", inferred.every((d) => d.createdAt === "2026-11-23"));
  is("kept createdAt for the rest", plan.docs.filter((d) => !d.createdAtInferred).every((d) => d.createdAt === "2026-01-15"));
  const ranged = plan.docs.find((d) => d.id === "t_07");
  eq("existing range kept", [ranged.durationMin, ranged.durationMax], [10, 20]);
  const mapped = plan.docs.find((d) => d.id === "t_04");
  eq("legacy duration 30 → 30-30", [mapped.durationMin, mapped.durationMax], [30, 30]);
  eq("30 minutes → unit min", mapped.durationUnit, "min");
  eq("range under an hour → unit min", ranged.durationUnit, "min");
  is("unit follows the 60-minute split", plan.docs.every((d) => d.durationUnit === (d.durationMax < 60 ? "min" : "hour")));
  const shaked = M.migrateTask({
    task: { id: "t_sh", title: "s", source: "shaked", duration: 90, createdAt: "2026-01-15" },
  }, { asOf: "2026-11-23" });
  eq("shaked source kept", shaked.doc.source, "shaked");
  eq("90 minutes → unit hour", shaked.doc.durationUnit, "hour");
  const capped = M.migrateTask({
    task: { id: "t_cap", title: "c", durationMin: 1, durationMax: 20000, createdAt: "2026-01-15" },
  }, { asOf: "2026-11-23" });
  eq("max clamps at 14400", capped.doc.durationMax, 14400);
  is("hierarchy ids filled", plan.docs.filter((d) => d.id === "t_00")[0].projectId === "p_one"
    && plan.docs.filter((d) => d.id === "t_19")[0].cityId === "c_two");

  console.log("report has counts only");
  const sha = M.sha256File(FIXTURE);
  is("sha256 is 64 hex", /^[0-9a-f]{64}$/.test(sha));
  const report = M.formatReport(plan, { sha256: sha, filePath: FIXTURE, mode: "dry-run" });
  is("report includes sha256", report.includes("sha256: " + sha));
  is("report includes counts", report.includes("documents to write: 20"));
  is("report does not include titles", !/T0[0-9]/.test(report) && !report.includes("title"));
  is("report does not include notes", !report.toLowerCase().includes("notes"));
  is("report mentions state untouched", report.includes("state blob: not modified"));

  console.log("mock write + verify; state untouched");
  const stateBefore = JSON.parse(JSON.stringify(state));
  const backend = M.createMemoryBackend(state);
  const { written, stateAfter } = await M.writeTasks(backend, plan.docs);
  eq("wrote 20 task docs", written.length, 20);
  const ver = M.verifyWritten(plan, written, stateBefore, stateAfter);
  is("verification ok", ver.ok);
  eq("verify issues", ver.issues, []);
  eq("state unchanged after write", stateAfter, stateBefore);
  is("backend log is writeTask only", backend._log.every((e) => e.op === "writeTask"));
  is("no state write API used", !backend._log.some((e) => /state/i.test(e.op)));

  console.log("CLI dry-run (default) and execute refusal");
  const dry = spawnSync(process.execPath, ["migrate-tasks.js", FIXTURE], {
    cwd: path.join(__dirname, ".."), encoding: "utf8",
  });
  eq("dry-run exit 0", dry.status, 0);
  is("dry-run prints sha256", dry.stdout.includes("sha256:"));
  is("dry-run mode label", dry.stdout.includes("mode: dry-run"));
  is("dry-run stdout has no titles", !/T0[0-9]/.test(dry.stdout + dry.stderr));

  const noApproval = spawnSync(process.execPath, ["migrate-tasks.js", FIXTURE, "--execute"], {
    cwd: path.join(__dirname, ".."), encoding: "utf8",
  });
  eq("execute without approval exits 2", noApproval.status, 2);
  is("mentions approval flag", (noApproval.stderr || "").includes("--i-have-yossi-approval"));

  const execute = spawnSync(process.execPath, [
    "migrate-tasks.js", FIXTURE, "--execute", "--i-have-yossi-approval",
  ], { cwd: path.join(__dirname, ".."), encoding: "utf8" });
  eq("execute with approval still refuses live Firestore", execute.status, 2);
  is("refuses Firebase connection", /Firebase|Firestore/i.test(execute.stderr || ""));

  console.log("");
  console.log(passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
