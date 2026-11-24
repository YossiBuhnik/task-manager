// Dry-run migration tests. Fixture only. No Firebase.
// Run: node tests/migrate-tasks.test.js
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { spawnSync } = require("child_process");
const M = require("../scripts/migrate-tasks.js");
const TMBridge = require("../bridge/logic.js");

const FIXTURE = path.join(__dirname, "fixtures", "migrate-sample.json");
const ROOT = path.join(__dirname, "..");

let failed = 0;
let passed = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; console.log("  ok  " + name); }
  else { failed++; console.log("  FAIL " + name + "\n       got:      " + a + "\n       expected: " + e); }
}
function is(name, cond) { eq(name, !!cond, true); }

function task(over) {
  return Object.assign({ id: "t_x", title: "x", createdAt: "2026-01-15" }, over);
}

async function main() {
  console.log("mapping");
  const state = M.unwrapState(JSON.parse(fs.readFileSync(FIXTURE, "utf8")));
  const plan = M.planMigration(state, { asOf: "2026-11-23" });
  eq("20 tasks planned", plan.docs.length, 20);
  eq("input count", plan.inputTaskCount, 20);
  eq("status", plan.status, { todo: 8, doing: 2, done: 10 });
  eq("areas", plan.area, { area_office: 15, area_pm: 5 });
  eq("skipped", plan.skipped, 0);
  is("ids preserved", plan.docs.every((d, i) => d.id === "t_" + String(i).padStart(2, "0")));
  is("fixture sources empty", plan.docs.every((d) => d.source === ""));
  is("manual tasks are not awaiting review", plan.docs.every((d) => d.awaitingReview === false));
  is("stable idempotency keys", plan.docs.every((d) => d.idempotencyKey === "migrate:" + d.id));
  const ranged = plan.docs.find((d) => d.id === "t_07");
  eq("existing range kept", [ranged.durationMin, ranged.durationMax], [10, 20]);
  const mapped = plan.docs.find((d) => d.id === "t_04");
  eq("legacy duration 30", [mapped.durationMin, mapped.durationMax], [30, 30]);
  const bridgePlan = TMBridge.planMigration(state, { asOf: "2026-11-23" });
  eq("parity docs", bridgePlan.docs, plan.docs);
  eq("parity counts", [bridgePlan.counts.input, bridgePlan.counts.documents, bridgePlan.counts.skipped, bridgePlan.counts.missingCreatedAt, bridgePlan.counts.durationMapped], [plan.inputTaskCount, plan.docs.length, plan.skipped, plan.missingCreatedAt, plan.durationMapped]);
  eq("parity problems", bridgePlan.problems, plan.errors.map((e) => { const p = { code: e.error }; if (e.id) p.id = e.id; return p; }));

  console.log("unit conversion and clamp");
  eq("30 min", M.durationUnitOf(30, 30), "min");
  eq("90 min → hour", M.durationUnitOf(90, 90), "hour");
  eq("480 min → day", M.durationUnitOf(480, 480), "day");
  eq("2–3 days", M.durationUnitOf(960, 1440), "day");
  eq("45–75 stays min", M.durationUnitOf(45, 75), "min");
  const hour = M.migrateTask({ task: task({ id: "t_h", duration: 90 }) });
  eq("mapped 90 is hour", hour.doc.durationUnit, "hour");
  eq("one day minutes", M.DAY_MINUTES, 480);
  const day = M.migrateTask({ task: task({ id: "t_d", duration: 480 }) });
  eq("mapped 480 is day", [day.doc.durationMin, day.doc.durationMax, day.doc.durationUnit], [480, 480, "day"]);
  const capped = M.migrateTask({ task: task({ id: "t_cap", durationMin: 1, durationMax: 20000 }) });
  eq("clamp 14400", capped.doc.durationMax, M.DURATION_MAX);
  const low = M.migrateTask({ task: task({ id: "t_low", duration: 0 }) });
  eq("clamp min 1", [low.doc.durationMin, low.doc.durationMax], [1, 1]);

  console.log("awaitingReview");
  eq("shaked defaults to queue", M.migrateTask({ task: task({ id: "t_sh", source: "shaked" }) }).doc.awaitingReview, true);
  eq("shaked source kept", M.migrateTask({ task: task({ id: "t_sh2", source: "shaked" }) }).doc.source, "shaked");
  eq("explicit false kept", M.migrateTask({ task: task({ id: "t_ok", source: "shaked", awaitingReview: false }) }).doc.awaitingReview, false);
  eq("yossi is not queued", M.migrateTask({ task: task({ id: "t_y", source: "yossi" }) }).doc.awaitingReview, false);
  const bad = M.planMigration({ cities: [{ id: "c", areaId: "a", projects: [{ id: "p", tasks: [{ title: "no id" }, { id: "t_1", title: "a" }, { id: "t_1", title: "dup" }] }] }] });
  eq("invalid rows", bad.errors.map((e) => e.error), ["missing-id", "duplicate-id"]);
  eq("skipped count", bad.skipped, 2);

  console.log("idempotent re-run");
  const backend = M.createMemoryBackend(state);
  const first = await M.writeTasks(backend, plan.docs);
  const second = await M.writeTasks(backend, plan.docs);
  eq("first wrote 20", first.wrote, 20);
  eq("second wrote 0", second.wrote, 0);
  eq("second skipped 20", second.skipped, 20);
  eq("still 20 docs", backend.listTasks().length, 20);
  eq("state untouched", second.stateAfter, state);
  is("log is writeTask only", backend._log.every((e) => e.op === "writeTask") && backend._log.length === 20);

  console.log("rollback flag");
  const sandbox = { window: { TM_FLAGS: { readLegacyBlob: true } }, console };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, "data.js"), "utf8"), sandbox, { filename: "data.js" });
  const TM = sandbox.window.TM;
  is("readLegacyBlob true", TM.FLAGS.readLegacyBlob === true);
  const blobTask = state.cities[0].projects[0].tasks[0];
  const fromBlob = TM.assembleData({ teamState: state, tasks: [{ id: "t_other", title: "new", projectId: "nope" }], readLegacyBlob: true });
  const city = fromBlob.cities.find((c) => c.id === state.cities[0].id);
  const project = city.projects.find((p) => p.id === state.cities[0].projects[0].id);
  eq("rollback still shows blob task", project.tasks[0].id, blobTask.id);
  const cut = TM.assembleData({ teamState: state, tasks: plan.docs, readLegacyBlob: false });
  const cutCity = cut.cities.find((c) => (c.projects || []).some((p) => (p.tasks || []).length));
  const cutProject = cutCity.projects.find((p) => (p.tasks || []).length);
  is("flag false reads the collection", cutProject.tasks.some((t) => t.idempotencyKey && t.idempotencyKey.indexOf("migrate:") === 0));

  console.log("safety");
  let refused = false;
  try { M.assertSafePath("data/projects/secret.json"); } catch (e) { refused = /data\/projects/.test(e.message); }
  is("refuses data/projects", refused);
  const src = fs.readFileSync(path.join(ROOT, "scripts", "migrate-tasks.js"), "utf8");
  is("does not read the SA env", src.indexOf("process.env") === -1);
  const dry = spawnSync(process.execPath, ["scripts/migrate-tasks.js", FIXTURE, "--as-of=2026-11-23"], { cwd: ROOT, encoding: "utf8" });
  eq("dry-run exit 0", dry.status, 0);
  is("report has area counts", dry.stdout.includes("area area_office: 15") && dry.stdout.includes("area area_pm: 5"));
  is("report has status counts", dry.stdout.includes("status: todo=8 doing=2 done=10"));
  is("report has skipped", dry.stdout.includes("skipped/invalid: 0"));
  is("no titles in report", !/T0[0-9]/.test(dry.stdout));
  const exec = spawnSync(process.execPath, ["scripts/migrate-tasks.js", FIXTURE, "--execute"], { cwd: ROOT, encoding: "utf8" });
  eq("execute refused", exec.status, 2);
  is("execute names Firebase", /Firebase/.test(exec.stderr || ""));

  console.log("");
  console.log(passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
