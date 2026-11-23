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
  if (max >= DAY_MINUTES && min % DAY_MINUTES === 0 && max % DAY_MINUTES === 0) return "day";
  if (max >= 60 && min % 30 === 0 && max % 30 === 0) return "hour";
  return "min";
}

function validCreatedAt(v) {
  if (!v || typeof v !== "string") return false;
  return !isNaN(new Date(v));
}

function normalizeSource(source) {
  return SOURCES.indexOf(source) !== -1 ? source : "";
}

function awaitingReviewOf(task, source) {
  if (typeof task.awaitingReview === "boolean") return task.awaitingReview;
  return BOT_SOURCES.indexOf(source) !== -1;
}

function migrateTask(entry, { asOf, now } = {}) {
  const t = entry.task || {};
  if (!t.id || typeof t.id !== "string") return { ok: false, error: "missing-id" };
  const dur = durationRange(t);
  const inferred = !validCreatedAt(t.createdAt);
  const createdAt = inferred
    ? jerusalemDate(now, asOf)
    : (t.createdAt.length >= 10 ? t.createdAt.slice(0, 10) : t.createdAt);
  const source = normalizeSource(t.source != null ? t.source : "");
  const doc = {
    ...t,
    id: t.id,
    title: t.title || "",
    status: STATUS.indexOf(t.status) !== -1 ? t.status : "todo",
    priority: PRIORITY.indexOf(t.priority) !== -1 ? t.priority : "mid",
    due: t.due || "",
    durationMin: dur.durationMin,
    durationMax: dur.durationMax,
    durationUnit: durationUnitOf(dur.durationMin, dur.durationMax),
    duration: t.duration != null ? t.duration : dur.durationMin,
    source,
    awaitingReview: awaitingReviewOf(t, source),
    createdBy: t.createdBy || "",
    createdAt,
    projectId: t.projectId || entry.projectId || "",
    cityId: t.cityId || entry.cityId || "",
    areaId: t.areaId || entry.areaId || "",
    idempotencyKey: "migrate:" + t.id,
    version: Number.isInteger(t.version) ? t.version : 1,
  };
  if (inferred) doc.createdAtInferred = true;
  return {
    ok: true,
    doc,
    inferredCreatedAt: inferred,
    durationMapped: t.durationMin == null && t.durationMax == null,
  };
}

function histogram(docs, field, keys) {
  const h = {};
  for (const k of keys || []) h[k] = 0;
  for (const d of docs) {
    const k = d[field] == null || d[field] === "" ? "(none)" : d[field];
    h[k] = (h[k] || 0) + 1;
  }
  return h;
}

function planMigration(state, opts = {}) {
  const extracted = extractTasks(state);
  const docs = [];
  const errors = [];
  let missingCreatedAt = 0;
  let durationMapped = 0;
  const seen = new Set();
  for (const entry of extracted) {
    const result = migrateTask(entry, opts);
    if (!result.ok) {
      errors.push({ error: result.error });
      continue;
    }
    if (seen.has(result.doc.id)) {
      errors.push({ error: "duplicate-id", id: result.doc.id });
      continue;
    }
    seen.add(result.doc.id);
    docs.push(result.doc);
    if (result.inferredCreatedAt) missingCreatedAt++;
    if (result.durationMapped) durationMapped++;
  }
  return {
    inputTaskCount: extracted.length,
    docs,
    errors,
    skipped: errors.length,
    missingCreatedAt,
    durationMapped,
    status: histogram(docs, "status", STATUS),
    priority: histogram(docs, "priority", PRIORITY),
    area: histogram(docs, "areaId"),
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
