#!/usr/bin/env node
// migrate-tasks.js — PR3: copy tasks from a teams/main.state export into
// teams/main/tasks/{id}. Flat repo script. Node only; no Firebase secrets.
//
// Default mode is dry-run: prints counts, never writes.
// A write pass requires BOTH --execute and --i-have-yossi-approval, and even
// then this script will not open a live Firebase project (see writeTasks).
//
// ============================================================================
// FREEZE CHECKLIST — do this before any approved execute, after Yossi agrees
// ============================================================================
// [ ] Freeze / pause tasks_app.py `apply` (export and backup may remain).
// [ ] Freeze calendar-agent: stop its DIRECT Firestore service-account writes
//     and pause its Code.gs triggers (two-way calendar sync).
// [ ] Pause the Drive queue `task-manager-updates` (and its 5-minute drain).
// [ ] Backup: local JSON export + a Drive copy. Record the SHA-256 this
//     script prints for the input file.
// [ ] Run this script in dry-run against that backup and keep the report.
// [ ] After a successful write: do NOT delete or thin `teams/main.state`.
// [ ] Rollback is the app flag only: set window.TM_FLAGS.readLegacyBlob = true.
//     The new collection is left in place and unused. No automatic deletion.
// [ ] After Yossi approves the cut-over: unfreeze writers onto the Apps Script
//     bridge only (no leftover direct SA writes).
// ============================================================================
//
// Usage:
//   node migrate-tasks.js <export.json>
//   node migrate-tasks.js <export.json> --execute --i-have-yossi-approval
//
// createdAt placeholder rule:
//   If a task has no createdAt (missing, empty, or not a parseable date),
//   set createdAt to the migration run date in Asia/Jerusalem (YYYY-MM-DD)
//   and set createdAtInferred: true. Existing valid createdAt values are kept.
//   This date can be pinned with --as-of=YYYY-MM-DD.
//
// Existing tasks get awaitingReview: false. source is kept if already a
// contract value, otherwise "".
// Duration: durationMin/durationMax from the existing range, or from legacy
// `duration` (default 60) as a min=max range.
// Ids are preserved. The legacy `state` blob is never deleted or modified.
// Logs print counts and checksums only — never titles, notes, or private fields.

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const STATUS = ["todo", "doing", "done"];
const PRIORITY = ["high", "mid", "low"];
const SOURCES = ["michal-mail", "ron-site", "noga-tour", "joe", "ido", "yossi", ""];
const DURATION_MIN = 1;
const DURATION_MAX = 720;

function jerusalemDate(now, asOf) {
  if (asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf)) return asOf;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now || new Date());
  const pick = (t) => parts.find((p) => p.type === t).value;
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function sha256String(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function loadExport(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);
  return parsed;
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
          areaId: city.areaId || "",
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

function validCreatedAt(v) {
  if (!v || typeof v !== "string") return false;
  const d = new Date(v);
  return !isNaN(d);
}

function normalizeSource(source) {
  if (SOURCES.indexOf(source) !== -1) return source;
  return "";
}

function migrateTask(entry, { asOf, now } = {}) {
  const t = entry.task || {};
  if (!t.id) return { ok: false, error: "missing-id" };
  const dur = durationRange(t);
  const inferred = !validCreatedAt(t.createdAt);
  const createdAt = inferred ? jerusalemDate(now, asOf) : (t.createdAt.length >= 10 ? t.createdAt.slice(0, 10) : t.createdAt);
  const doc = {
    ...t,
    id: t.id,
    title: t.title || "",
    status: STATUS.indexOf(t.status) !== -1 ? t.status : "todo",
    priority: PRIORITY.indexOf(t.priority) !== -1 ? t.priority : "mid",
    due: t.due || "",
    durationMin: dur.durationMin,
    durationMax: dur.durationMax,
    duration: t.duration != null ? t.duration : dur.durationMin,
    source: normalizeSource(t.source != null ? t.source : ""),
    awaitingReview: false,
    createdBy: t.createdBy || "",
    createdAt,
    projectId: t.projectId || entry.projectId || "",
    cityId: t.cityId || entry.cityId || "",
    areaId: t.areaId || entry.areaId || "",
    version: Number.isInteger(t.version) ? t.version : 1,
  };
  if (inferred) doc.createdAtInferred = true;
  return { ok: true, doc, inferredCreatedAt: inferred, durationMapped: t.durationMin == null && t.durationMax == null };
}

function histogram(docs, field, keys) {
  const h = {};
  for (const k of keys) h[k] = 0;
  for (const d of docs) {
    const k = d[field];
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
      errors.push({ error: "duplicate-id" });
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
    missingCreatedAt,
    durationMapped,
    status: histogram(docs, "status", STATUS),
    priority: histogram(docs, "priority", PRIORITY),
  };
}

function formatReport(plan, { sha256, filePath, mode }) {
  const lines = [];
  lines.push(`mode: ${mode}`);
  if (filePath) lines.push(`input: ${path.basename(filePath)}`);
  if (sha256) lines.push(`sha256: ${sha256}`);
  lines.push(`tasks in export: ${plan.inputTaskCount}`);
  lines.push(`documents to write: ${plan.docs.length}`);
  lines.push(`errors: ${plan.errors.length}`);
  lines.push(`missing createdAt (inferred): ${plan.missingCreatedAt}`);
  lines.push(`duration mapped from legacy field: ${plan.durationMapped}`);
  lines.push(`status: todo=${plan.status.todo} doing=${plan.status.doing} done=${plan.status.done}`);
  lines.push(`priority: high=${plan.priority.high} mid=${plan.priority.mid} low=${plan.priority.low}`);
  lines.push("state blob: not modified (rollback = TM.FLAGS.readLegacyBlob)");
  return lines.join("\n");
}

function verifyWritten(plan, writtenDocs, stateBefore, stateAfter) {
  const issues = [];
  if (writtenDocs.length !== plan.docs.length) {
    issues.push(`count mismatch: written ${writtenDocs.length} planned ${plan.docs.length}`);
  }
  const writtenStatus = histogram(writtenDocs, "status", STATUS);
  const writtenPriority = histogram(writtenDocs, "priority", PRIORITY);
  for (const k of STATUS) {
    if (writtenStatus[k] !== plan.status[k]) issues.push(`status ${k} mismatch`);
  }
  for (const k of PRIORITY) {
    if (writtenPriority[k] !== plan.priority[k]) issues.push(`priority ${k} mismatch`);
  }
  const plannedIds = plan.docs.map((d) => d.id).sort();
  const writtenIds = writtenDocs.map((d) => d.id).sort();
  if (JSON.stringify(plannedIds) !== JSON.stringify(writtenIds)) issues.push("id set mismatch");
  if (JSON.stringify(stateBefore) !== JSON.stringify(stateAfter)) issues.push("state blob was modified");
  return { ok: issues.length === 0, issues, writtenStatus, writtenPriority };
}

// Backend: { getState(), setState?(), writeTask(id, doc), listTasks() }
// writeTasks never calls setState and never deletes state.
async function writeTasks(backend, docs) {
  const stateBefore = backend.getState ? clone(backend.getState()) : null;
  for (const doc of docs) {
    await backend.writeTask(doc.id, doc);
  }
  const stateAfter = backend.getState ? clone(backend.getState()) : null;
  const written = backend.listTasks ? backend.listTasks() : docs;
  return { stateBefore, stateAfter, written };
}

function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

function createMemoryBackend(initialState) {
  const state = clone(initialState || { areas: [], cities: [] });
  const tasks = new Map();
  const log = [];
  return {
    getState: () => clone(state),
    listTasks: () => [...tasks.values()].map(clone),
    writeTask: async (id, doc) => {
      log.push({ op: "writeTask", id });
      tasks.set(id, clone(doc));
    },
    // Deliberately no deleteState / setState used by the migrator.
    _log: log,
    _tasks: tasks,
  };
}

function parseArgs(argv) {
  const args = { file: null, execute: false, approval: false, asOf: null };
  for (const a of argv.slice(2)) {
    if (a === "--execute") args.execute = true;
    else if (a === "--i-have-yossi-approval") args.approval = true;
    else if (a.startsWith("--as-of=")) args.asOf = a.slice(8);
    else if (a.startsWith("-")) throw new Error("unknown flag: " + a);
    else args.file = a;
  }
  return args;
}

async function main(argv) {
  const args = parseArgs(argv);
  if (!args.file) {
    console.error("usage: node migrate-tasks.js <export.json> [--as-of=YYYY-MM-DD]");
    process.exit(2);
  }
  const sha = sha256File(args.file);
  const state = unwrapState(loadExport(args.file));
  const plan = planMigration(state, { asOf: args.asOf });
  const mode = args.execute ? "execute" : "dry-run";
  console.log(formatReport(plan, { sha256: sha, filePath: args.file, mode }));

  if (!args.execute) {
    if (plan.errors.length) process.exit(1);
    return { mode, plan, sha };
  }
  if (!args.approval) {
    console.error("refusing to execute: --i-have-yossi-approval is required");
    process.exit(2);
  }
  // Live Firebase writes are not performed here. No service-account env is read.
  console.error("refusing live Firestore write: this script does not connect to Firebase. Dry-run / tests use an in-memory backend. An approved operator procedure is required for a live write.");
  process.exit(2);
}

if (require.main === module) {
  main(process.argv).catch((err) => {
    console.error(err && err.message ? err.message : String(err));
    process.exit(1);
  });
}

module.exports = {
  jerusalemDate,
  sha256File,
  sha256String,
  unwrapState,
  extractTasks,
  migrateTask,
  planMigration,
  formatReport,
  verifyWritten,
  writeTasks,
  createMemoryBackend,
  parseArgs,
  main,
};
