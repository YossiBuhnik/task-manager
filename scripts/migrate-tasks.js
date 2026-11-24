#!/usr/bin/env node
// scripts/migrate-tasks.js — PR3 dry-run only.
// Reads a teams/main.state JSON export (fixture or local file) and prints
// what would be written to teams/main/tasks/{id}. Never connects to Firebase,
// never reads FIREBASE_TASKS_SA_JSON, never reads data/projects/*.json.
// The legacy state blob is not modified. Rollback is
// window.TM_FLAGS.readLegacyBlob = true; the new collection stays unused.
//
//   node scripts/migrate-tasks.js <export.json> [--as-of=YYYY-MM-DD]

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const TMBridge = require("../bridge/logic.js");

const STATUS = ["todo", "doing", "done"];
const PRIORITY = ["high", "mid", "low"];
const SOURCES = ["michal-mail", "ron-site", "noga-tour", "joe", "ido", "shaked", "calendar-agent", "yossi", ""];
const BOT_SOURCES = ["michal-mail", "ron-site", "noga-tour", "joe", "ido", "shaked", "calendar-agent"];
const DURATION_MIN = 1;
const DURATION_MAX = 14400;
const DAY_MINUTES = 480;

function jerusalemDate(now, asOf) {
  if (asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf)) return asOf;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now || new Date());
  const pick = (t) => parts.find((p) => p.type === t).value;
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function assertSafePath(filePath) {
  const norm = path.resolve(filePath).split(path.sep).join("/");
  if (norm.includes("/data/projects/")) throw new Error("refusing to read data/projects");
  if (path.basename(filePath).indexOf("FIREBASE") !== -1) throw new Error("refusing secret file");
}

function loadExport(filePath) {
  assertSafePath(filePath);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function unwrapState(parsed) {
  if (!parsed || typeof parsed !== "object") throw new Error("export is not an object");
  if (parsed.state && (parsed.state.cities || parsed.state.areas)) return parsed.state;
  if (parsed.cities || parsed.areas) return parsed;
  throw new Error("export has no state / cities / areas");
}

function extractTasks(state) {
  const out = [];
  for (const city of state.cities || []) {
    for (const project of city.projects || []) {
      for (const task of project.tasks || []) {
        out.push({
          task,
          cityId: city.id || "",
          projectId: project.id || "",
          areaId: city.areaId || (city.area && city.area.id) || "",
        });
      }
    }
  }
  return out;
}

function asInt(n, fallback) {
  const v = Number(n);
  return Number.isInteger(v) ? v : fallback;
}

function durationRange(task) {
  let min = task.durationMin;
  let max = task.durationMax;
  if (min == null && max == null) {
    const d = asInt(task.duration, 60);
    min = max = d;
  }
  min = asInt(min, 60);
  max = asInt(max, min);
  if (min < DURATION_MIN) min = DURATION_MIN;
  if (max > DURATION_MAX) max = DURATION_MAX;
  if (min > max) max = min;
  return { durationMin: min, durationMax: max };
}

function durationUnitOf(min, max) {
  return TMBridge.durationUnitOf(min, max);
}

function migrateTask(entry, opts = {}) {
  return TMBridge.migrateOne(entry, opts);
}

function planMigration(state, opts = {}) {
  const planned = TMBridge.planMigration(state, opts);
  return {
    inputTaskCount: planned.counts.input,
    docs: planned.docs,
    errors: (planned.problems || []).map((p) => {
      const e = { error: p.code };
      if (p.id) e.id = p.id;
      return e;
    }),
    skipped: planned.counts.skipped,
    missingCreatedAt: planned.counts.missingCreatedAt,
    durationMapped: planned.counts.durationMapped,
    status: planned.counts.status,
    priority: planned.counts.priority,
    area: planned.counts.area,
  };
}

function formatReport(plan, { sha256, filePath } = {}) {
  const lines = [];
  lines.push("mode: dry-run");
  if (filePath) lines.push("input: " + path.basename(filePath));
  if (sha256) lines.push("sha256: " + sha256);
  lines.push("tasks in export: " + plan.inputTaskCount);
  lines.push("documents to write: " + plan.docs.length);
  lines.push("skipped/invalid: " + plan.skipped);
  const byError = {};
  for (const e of plan.errors) byError[e.error] = (byError[e.error] || 0) + 1;
  const errKeys = Object.keys(byError).sort();
  lines.push("invalid rows: " + (errKeys.length ? errKeys.map((k) => k + "=" + byError[k]).join(" ") : "none"));
  lines.push("missing createdAt (inferred): " + plan.missingCreatedAt);
  lines.push("duration mapped from legacy field: " + plan.durationMapped);
  lines.push("status: todo=" + (plan.status.todo || 0) + " doing=" + (plan.status.doing || 0) + " done=" + (plan.status.done || 0));
  const areas = Object.keys(plan.area).sort();
  for (const a of areas) lines.push("area " + a + ": " + plan.area[a]);
  lines.push("state blob: not modified (rollback = TM.FLAGS.readLegacyBlob)");
  return lines.join("\n");
}

function clone(x) { return JSON.parse(JSON.stringify(x)); }

function createMemoryBackend(initialState) {
  const state = clone(initialState || { areas: [], cities: [] });
  const tasks = new Map();
  const keys = new Set();
  const log = [];
  return {
    getState: () => clone(state),
    listTasks: () => [...tasks.values()].map(clone),
    hasKey: (key) => keys.has(key),
    rememberKey: (key) => { keys.add(key); },
    writeTask: async (id, doc) => {
      log.push({ op: "writeTask", id });
      tasks.set(id, clone(doc));
    },
    _log: log,
    _tasks: tasks,
  };
}

// In-memory only. A second pass with the same idempotencyKey writes nothing.
async function writeTasks(backend, docs) {
  const stateBefore = backend.getState ? clone(backend.getState()) : null;
  let wrote = 0;
  let skipped = 0;
  for (const doc of docs) {
    if (backend.hasKey && backend.hasKey(doc.idempotencyKey)) {
      skipped++;
      continue;
    }
    await backend.writeTask(doc.id, doc);
    if (backend.rememberKey) backend.rememberKey(doc.idempotencyKey);
    wrote++;
  }
  const stateAfter = backend.getState ? clone(backend.getState()) : null;
  return {
    stateBefore,
    stateAfter,
    written: backend.listTasks ? backend.listTasks() : docs,
    wrote,
    skipped,
  };
}

function parseArgs(argv) {
  const args = { file: null, execute: false, asOf: null };
  for (const a of argv.slice(2)) {
    if (a === "--execute" || a === "--i-have-yossi-approval") args.execute = true;
    else if (a.startsWith("--as-of=")) args.asOf = a.slice(8);
    else if (a.startsWith("-")) throw new Error("unknown flag: " + a);
    else args.file = a;
  }
  return args;
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.execute) {
    console.error("dry-run only: this script does not connect to Firebase and does not read FIREBASE_TASKS_SA_JSON");
    process.exit(2);
  }
  if (!args.file) {
    console.error("usage: node scripts/migrate-tasks.js <export.json> [--as-of=YYYY-MM-DD]");
    process.exit(2);
  }
  assertSafePath(args.file);
  const sha = sha256File(args.file);
  const plan = planMigration(unwrapState(loadExport(args.file)), { asOf: args.asOf });
  console.log(formatReport(plan, { sha256: sha, filePath: args.file }));
  if (plan.errors.length) process.exit(1);
  return { mode: "dry-run", plan, sha };
}

if (require.main === module) {
  main(process.argv).catch((err) => {
    console.error(err && err.message ? err.message : String(err));
    process.exit(1);
  });
}

module.exports = {
  DAY_MINUTES, DURATION_MAX, SOURCES, BOT_SOURCES,
  jerusalemDate, sha256File, assertSafePath, unwrapState, extractTasks,
  durationRange, durationUnitOf, migrateTask, planMigration, formatReport,
  writeTasks, createMemoryBackend, parseArgs, main,
};
