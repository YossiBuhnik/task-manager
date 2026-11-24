// Tiny no-dependency tests for the PR1 data layer.
// Run: node tests/data-layer.test.js
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const src = fs.readFileSync(path.join(__dirname, "..", "data.js"), "utf8");
const sandbox = { window: { TM_FLAGS: { readLegacyBlob: true } }, console };
vm.runInNewContext(src, sandbox, { filename: "data.js" });
const TM = sandbox.window.TM;
if (!TM) throw new Error("TM was not exported");

let failed = 0;
let passed = 0;

function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log("  ok  " + name);
  } else {
    failed++;
    console.log("  FAIL " + name + "\n       got:      " + a + "\n       expected: " + e);
  }
}
function is(name, cond) { eq(name, !!cond, true); }

function clone(x) { return JSON.parse(JSON.stringify(x)); }

function applyDots(target, fields) {
  const out = clone(target || {});
  for (const [k, v] of Object.entries(fields)) {
    if (k.includes(".")) {
      const parts = k.split(".");
      let cur = out;
      for (let i = 0; i < parts.length - 1; i++) {
        if (cur[parts[i]] == null || typeof cur[parts[i]] !== "object") cur[parts[i]] = {};
        cur = cur[parts[i]];
      }
      cur[parts[parts.length - 1]] = (v && typeof v === "object" && !v._sv) ? clone(v) : v;
    } else {
      out[k] = (v && typeof v === "object" && !v._sv) ? clone(v) : v;
    }
  }
  return out;
}

function createMemoryFirestore() {
  const team = { exists: false, data: {} };
  const tasks = new Map();
  const log = [];
  const doc = (_db, ...segments) => ({ _path: segments.join("/"), _segments: segments });
  const collection = (_db, ...segments) => ({ _path: segments.join("/"), _segments: segments, _col: true });

  const setDoc = async (ref, data, opts = {}) => {
    log.push({ op: "setDoc", path: ref._path, merge: !!opts.merge, data: clone(data) });
    if (ref._path === "teams/main") {
      team.exists = true;
      team.data = opts.merge ? applyDots(team.data, data) : clone(data);
    } else if (ref._path.startsWith("teams/main/tasks/")) {
      const id = ref._segments[3];
      tasks.set(id, clone({ ...data, id }));
    }
  };
  const updateDoc = async (ref, fields) => {
    log.push({ op: "updateDoc", path: ref._path, data: clone(fields) });
    if (ref._path === "teams/main") {
      if (!team.exists) { const err = new Error("not-found"); err.code = "not-found"; throw err; }
      team.data = applyDots(team.data, fields);
    } else if (ref._path.startsWith("teams/main/tasks/")) {
      const id = ref._segments[3];
      if (!tasks.has(id)) { const err = new Error("not-found"); err.code = "not-found"; throw err; }
      tasks.set(id, applyDots(tasks.get(id), fields));
    }
  };
  const deleteDoc = async (ref) => {
    log.push({ op: "deleteDoc", path: ref._path });
    if (ref._path.startsWith("teams/main/tasks/")) tasks.delete(ref._segments[3]);
  };
  const runTransaction = async (_db, fn) => {
    const pending = [];
    const tx = {
      async get(ref) {
        if (ref._path === "teams/main") {
          return { exists: () => team.exists, data: () => clone(team.data), id: "main" };
        }
        const id = ref._segments[3];
        const cur = tasks.has(id) ? tasks.get(id) : null;
        return { exists: () => !!cur, data: () => clone(cur), id };
      },
      set(ref, data, opts) { pending.push({ type: "set", ref, data, opts: opts || {} }); },
      update(ref, data) { pending.push({ type: "update", ref, data }); },
      delete(ref) { pending.push({ type: "delete", ref }); },
    };
    await fn(tx);
    for (const p of pending) {
      if (p.type === "set") await setDoc(p.ref, p.data, p.opts || {});
      else if (p.type === "update") await updateDoc(p.ref, p.data);
      else if (p.type === "delete") await deleteDoc(p.ref);
    }
  };

  const seedTeam = (state) => {
    team.exists = true;
    team.data = { state: clone(state) };
  };

  return {
    db: {}, doc, collection, setDoc, updateDoc, deleteDoc, runTransaction,
    serverTimestamp: () => ({ _sv: true }),
    seedTeam,
    _log: log, _team: team, _tasks: tasks,
  };
}

function createLayer(fb, { readLegacyBlob = false } = {}) {
  const col = "teams", id = "main";
  const teamRef = fb.doc(fb.db, col, id);
  const taskRef = (taskId) => fb.doc(fb.db, col, id, "tasks", taskId);

  const writeTeamFromTx = (tx, snap, state) => {
    const meta = { updatedAt: fb.serverTimestamp(), updatedBy: TM.YOSSI_EMAIL };
    if (!snap.exists()) tx.set(teamRef, { state, ...meta }, { merge: true });
    else tx.update(teamRef, { state, ...meta });
  };

  const runLegacyTx = async (op) => {
    try {
      await fb.runTransaction(fb.db, async (tx) => {
        const snap = await tx.get(teamRef);
        const remote = snap.exists() ? snap.data() : null;
        const current = remote && remote.state ? remote.state : (remote || { areas: [], cities: [] });
        const result = TM.applyLegacyBlobMutation(current, op);
        if (!result.ok) throw result.error;
        writeTeamFromTx(tx, snap, result.state);
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err };
    }
  };

  const updateTeamState = async (partial) => {
    if (readLegacyBlob) return runLegacyTx({ kind: "team", areas: partial.areas, cities: partial.cities });
    try {
      await fb.runTransaction(fb.db, async (tx) => {
        const snap = await tx.get(teamRef);
        const meta = { updatedAt: fb.serverTimestamp(), updatedBy: TM.YOSSI_EMAIL };
        if (!snap.exists()) {
          const state = {};
          if (partial.areas) state.areas = partial.areas;
          if (partial.cities) state.cities = partial.cities;
          tx.set(teamRef, { state, ...meta }, { merge: true });
        } else {
          const payload = { ...meta };
          if (partial.areas) payload["state.areas"] = partial.areas;
          if (partial.cities) payload["state.cities"] = partial.cities;
          tx.update(teamRef, payload);
        }
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err };
    }
  };

  const runTaskTx = async (taskId, op) => {
    if (readLegacyBlob) {
      return runLegacyTx({ kind: "task", type: op.type, task: op.task, taskId, fields: op.fields });
    }
    try {
      await fb.runTransaction(fb.db, async (tx) => {
        const snap = await tx.get(taskRef(taskId));
        const existing = snap.exists() ? snap.data() : null;
        const result = TM.applyTaskMutation(existing, op);
        if (!result.ok) throw result.error;
        if (result.deleted) tx.delete(taskRef(taskId));
        else tx.set(taskRef(taskId), { ...result.doc, updatedAt: fb.serverTimestamp() });
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err };
    }
  };

  return {
    updateTeamState,
    createTask: (task) => runTaskTx(task.id, { type: "create", task }),
    updateTaskDoc: (taskId, fields, expectedVersion) =>
      runTaskTx(taskId, { type: "update", fields, expectedVersion }),
    moveTaskDoc: async (taskId, targetProjectId) => {
      if (readLegacyBlob) return runTaskTx(taskId, { type: "move", targetProjectId });
      const team = fb._team.data && fb._team.data.state;
      const tasks = [...fb._tasks.values()];
      const tree = TM.assembleData({ teamState: team, tasks, readLegacyBlob: false });
      const plan = TM.moveTaskInState(tree, taskId, targetProjectId);
      if (!plan.ok || !plan.moved) return plan.ok ? { ok: true } : plan;
      return runTaskTx(taskId, {
        type: "update",
        fields: plan.fields,
        expectedVersion: plan.task.version,
      });
    },
    deleteTaskDoc: (taskId, expectedVersion) =>
      runTaskTx(taskId, { type: "delete", expectedVersion }),
    approveTask: (taskId, expectedVersion) =>
      runTaskTx(taskId, { type: "update", fields: { awaitingReview: false }, expectedVersion }),
  };
}

const YOSSI = TM.YOSSI_EMAIL;
const sampleTeam = {
  areas: [{ id: "area_office", name: "משרד", visibility: "shared", owner: null }],
  cities: [{
    id: "c1", name: "City", areaId: "area_office", visibility: "shared", owner: null,
    projects: [{ id: "p1", name: "Proj", visibility: "shared", owner: null, tasks: [] }],
  }],
};
const sampleTask = (over = {}) => TM.normalizeTask({
  id: "t_one", title: "Do it", status: "todo", priority: "mid", due: "2026-11-24",
  projectId: "p1", cityId: "c1", areaId: "area_office",
  source: "", awaitingReview: false, createdBy: YOSSI, createdAt: "2026-11-23",
  ...over,
}, sampleTeam, YOSSI);

async function main() {
  console.log("app reads the task collection");
  const cfgBox = { window: {}, location: { hostname: "yossibuhnik.github.io" } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "firebase-config.js"), "utf8"), cfgBox, { filename: "firebase-config.js" });
  eq("firebase-config readLegacyBlob", cfgBox.window.TM_FLAGS.readLegacyBlob, false);
  const appBox = { window: { TM_FLAGS: { readLegacyBlob: false } }, console };
  vm.runInNewContext(src, appBox, { filename: "data.js" });
  eq("app data layer follows the flag", appBox.window.TM.FLAGS.readLegacyBlob, false);

  console.log("rollback flag still selects the blob");
  is("explicit readLegacyBlob true", TM.FLAGS.readLegacyBlob === true);

  console.log("assembleData: fallback flag vs collection");
  const blobTeam = {
    areas: sampleTeam.areas,
    cities: [{
      ...sampleTeam.cities[0],
      projects: [{ id: "p1", name: "Proj", visibility: "shared", owner: null,
        tasks: [sampleTask({ id: "t_blob", title: "from blob" })] }],
    }],
  };
  const colTasks = [sampleTask({ id: "t_col", title: "from collection" })];
  const fromBlob = TM.assembleData({ teamState: blobTeam, tasks: colTasks, readLegacyBlob: true });
  eq("legacy fallback uses blob task", TM.allTasks(fromBlob).map((t) => t.id), ["t_blob"]);
  const fromCol = TM.assembleData({ teamState: blobTeam, tasks: colTasks, readLegacyBlob: false });
  eq("collection path ignores nested blob tasks", TM.allTasks(fromCol).map((t) => t.id), ["t_col"]);

  console.log("per-doc writes; no blob overwrite");
  {
    const fb = createMemoryFirestore();
    const layer = createLayer(fb, { readLegacyBlob: false });
    const created = await layer.createTask(sampleTask());
    is("createTask ok", created.ok);
    is("task stored as its own doc", fb._tasks.has("t_one"));
    eq("task title", fb._tasks.get("t_one").title, "Do it");
    eq("createTask does not write team doc", fb._log.filter((e) => e.path === "teams/main").length, 0);
    const upd = await layer.updateTeamState(TM.teamStateForWrite(sampleTeam));
    is("updateTeamState ok (first-time merge create)", upd.ok);
    const teamLog = fb._log.filter((e) => e.path === "teams/main");
    is("team write is updateDoc or setDoc merge:true",
      teamLog.every((e) => e.op === "updateDoc" || (e.op === "setDoc" && e.merge === true)));
    is("never setDoc merge:false on team doc",
      !fb._log.some((e) => e.op === "setDoc" && e.path === "teams/main" && e.merge === false));
    is("cities written without tasks as SoT",
      (fb._team.data.state.cities[0].projects[0].tasks || []).length === 0);
    const del = await layer.deleteTaskDoc("t_one", fb._tasks.get("t_one").version);
    is("deleteTask ok", del.ok);
    is("task doc removed", !fb._tasks.has("t_one"));
  }

  console.log("concurrent update conflict");
  {
    const fb = createMemoryFirestore();
    const layer = createLayer(fb, { readLegacyBlob: false });
    await layer.createTask(sampleTask({ version: 1 }));
    const first = await layer.updateTaskDoc("t_one", { title: "A" }, 1);
    const second = await layer.updateTaskDoc("t_one", { title: "B" }, 1);
    is("first update ok", first.ok);
    is("second update conflicts", !second.ok && second.error && second.error.code === "conflict");
    eq("stored title is the first writer", fb._tasks.get("t_one").title, "A");
    eq("version advanced once", fb._tasks.get("t_one").version, 2);
  }

  console.log("approveTask flips awaitingReview");
  {
    const fb = createMemoryFirestore();
    const layer = createLayer(fb, { readLegacyBlob: false });
    await layer.createTask(sampleTask({ awaitingReview: true, source: "michal-mail", createdBy: "michal-mail", version: 1 }));
    const ap = await layer.approveTask("t_one", 1);
    is("approve ok", ap.ok);
    eq("awaitingReview is false", fb._tasks.get("t_one").awaitingReview, false);
    eq("source preserved", fb._tasks.get("t_one").source, "michal-mail");
    eq("no longer in inbox", TM.listInbox([fb._tasks.get("t_one")]).map((t) => t.id), []);
  }

  console.log("legacy path stays fully writable (surgical blob tx)");
  {
    const fb = createMemoryFirestore();
    fb.seedTeam(sampleTeam);
    const layer = createLayer(fb, { readLegacyBlob: true });
    const created = await layer.createTask(sampleTask({ id: "t_one", title: "Do it" }));
    is("legacy createTask ok", created.ok);
    const titles = TM.allTasks(fb._team.data.state).map((t) => t.title);
    eq("legacy task landed in blob", titles, ["Do it"]);
    eq("legacy create does not write a per-task doc", fb._tasks.size, 0);
    is("legacy write is updateDoc on existing team doc",
      fb._log.some((e) => e.op === "updateDoc" && e.path === "teams/main"));
    is("legacy never setDoc over existing team doc",
      !fb._log.some((e) => e.op === "setDoc" && e.path === "teams/main"));
  }

  console.log("legacy concurrent edit: bot change to another task is kept");
  {
    const fb = createMemoryFirestore();
    const a = sampleTask({ id: "t_a", title: "A" });
    const b = sampleTask({ id: "t_b", title: "B" });
    const seeded = TM.applyLegacyBlobMutation(sampleTeam, { kind: "task", type: "create", task: a }).state;
    const seeded2 = TM.applyLegacyBlobMutation(seeded, { kind: "task", type: "create", task: b }).state;
    fb.seedTeam(seeded2);
    // Bot writes t_b directly on the blob (as calendar-agent / tasks_app.py do today).
    const afterBot = TM.applyLegacyBlobMutation(fb._team.data.state, {
      kind: "task", type: "update", taskId: "t_b", fields: { title: "B-bot" },
    }).state;
    fb.seedTeam(afterBot);
    const layer = createLayer(fb, { readLegacyBlob: true });
    const user = await layer.updateTaskDoc("t_a", { title: "A-user" });
    is("user update ok", user.ok);
    const tasks = Object.fromEntries(TM.allTasks(fb._team.data.state).map((t) => [t.id, t.title]));
    eq("user change applied", tasks["t_a"], "A-user");
    eq("bot change to the other task was not lost", tasks["t_b"], "B-bot");
  }

  console.log("first-time team doc: setDoc merge:true only when missing");
  {
    const fb = createMemoryFirestore();
    is("doc starts missing", fb._team.exists === false);
    const layer = createLayer(fb, { readLegacyBlob: false });
    const first = await layer.updateTeamState(TM.teamStateForWrite(sampleTeam));
    is("create via merge:true ok", first.ok);
    is("used setDoc merge:true",
      fb._log.some((e) => e.op === "setDoc" && e.path === "teams/main" && e.merge === true));
    fb._log.length = 0;
    const second = await layer.updateTeamState(TM.teamStateForWrite(sampleTeam));
    is("second write ok", second.ok);
    is("existing doc uses updateDoc, not setDoc",
      fb._log.some((e) => e.op === "updateDoc" && e.path === "teams/main") &&
      !fb._log.some((e) => e.op === "setDoc" && e.path === "teams/main"));
  }

  console.log("replaceAll / resetSeed only in local mode");
  is("local allows bulk replace", TM.canBulkReplaceData(false) === true);
  is("cloud rejects bulk replace", TM.canBulkReplaceData(true) === false);

  console.log("client guards");
  {
    const bot = sampleTask({ source: "michal-mail", createdBy: "michal-mail", awaitingReview: true });
    is("Yossi can edit bot task", TM.canEditTask(bot, YOSSI, sampleTeam));
    is("Yossi can approve", TM.canApproveTask(bot, YOSSI, sampleTeam));
    is("non-Yossi cannot edit bot task", !TM.canEditTask(bot, "other@example.com", sampleTeam));
    is("non-Yossi cannot approve", !TM.canApproveTask(bot, "other@example.com", sampleTeam));
    const manual = sampleTask({ source: "", createdBy: YOSSI });
    is("Yossi can edit manual", TM.canEditTask(manual, YOSSI, sampleTeam));
    const privateTeam = {
      areas: [{ id: "area_x", name: "X", visibility: "private", owner: YOSSI }],
      cities: [{
        id: "c1", name: "City", areaId: "area_x", visibility: "private", owner: YOSSI,
        projects: [{ id: "p1", name: "Proj", visibility: "private", owner: YOSSI, tasks: [] }],
      }],
    };
    const priv = TM.normalizeTask(sampleTask({ visibility: "private", owner: YOSSI }), privateTeam, YOSSI);
    is("owner can read private", TM.canReadTask(priv, YOSSI, privateTeam));
    is("non-owner cannot read private", !TM.canReadTask(priv, "other@example.com", privateTeam));
    is("non-owner cannot edit private", !TM.canEditTask(priv, "other@example.com", privateTeam));
  }

  console.log("normalize duration range + team strip");
  {
    const n = TM.normalizeTask({ id: "t_d", title: "x", duration: 45, projectId: "p1", cityId: "c1" }, sampleTeam, YOSSI);
    eq("legacy duration → min=max", [n.durationMin, n.durationMax], [45, 45]);
    const stripped = TM.teamStateForWrite({
      areas: sampleTeam.areas,
      cities: [{
        ...sampleTeam.cities[0],
        projects: [{ id: "p1", name: "Proj", tasks: [sampleTask()] }],
      }],
    });
    eq("stripped tasks empty", stripped.cities[0].projects[0].tasks, []);
  }

  console.log("waiting on others");
  is("assignee is not waiting", !TM.isWaitingOnOthers({ status: "todo", assignee: "דנה", source: "michal-mail" }));
  is("bot source is not waiting", !TM.isWaitingOnOthers({ status: "todo", source: "shaked", assignee: "" }));
  is("done is not waiting", !TM.isWaitingOnOthers({ status: "done", waitingOn: "עירייה" }));
  is("waitingOn string counts", TM.isWaitingOnOthers({ status: "todo", waitingOn: "עירייה" }));
  is("waitingOn party counts", TM.isWaitingOnOthers({ status: "doing", waitingOn: { party: "מחלקת הנדסה" } }));
  is("empty waitingOn does not count", !TM.isWaitingOnOthers({ status: "todo", waitingOn: "" }));
  is("status waiting counts", TM.isWaitingOnOthers({ status: "waiting" }));

  console.log("decideProposal");
  {
    const task = { id: "t_p", title: "Keep", status: "todo", proposals: [{ id: "prop_1", kind: "done", state: "pending" }] };
    const accepted = TM.decideProposal(task, "prop_1", "accept");
    is("accept ok", accepted.ok);
    eq("accept sets done", accepted.task.status, "done");
    eq("accept marks proposal", accepted.task.proposals[0].state, "accepted");
    const edit = { id: "t_e", title: "Old", status: "todo", due: "", proposals: [{ id: "prop_e", kind: "edit", state: "pending", fields: { due: "2026-12-01" } }] };
    const rejected = TM.decideProposal(edit, "prop_e", "reject");
    eq("reject leaves title", rejected.task.title, "Old");
    eq("reject leaves due", rejected.task.due, "");
    eq("reject state", rejected.task.proposals[0].state, "rejected");
  }

  console.log("moveTask");
  {
    const team = {
      areas: [
        { id: "area_office", name: "משרד" },
        { id: "area_pm", name: "ניהול" },
      ],
      cities: [
        { id: "c1", areaId: "area_office", projects: [{ id: "p1", tasks: [] }] },
        { id: "c2", areaId: "area_pm", projects: [{ id: "p2", tasks: [] }] },
      ],
    };
    const task = { id: "t_move", title: "Keep me", projectId: "p1", cityId: "c1", areaId: "area_office", notes: "history", activity: [{ op: "note" }] };
    const seeded = TM.applyLegacyBlobMutation(team, { kind: "task", type: "create", task }).state;
    const moved = TM.applyLegacyBlobMutation(seeded, { kind: "task", type: "move", taskId: "t_move", targetProjectId: "p2", at: "2026-11-23T00:00:00.000Z" });
    is("legacy move ok", moved.ok);
    eq("left the old project", moved.state.cities[0].projects[0].tasks, []);
    const parked = moved.state.cities[1].projects[0].tasks[0];
    eq("same id", parked.id, "t_move");
    eq("notes kept", parked.notes, "history");
    eq("new project", parked.projectId, "p2");
    eq("area follows project", parked.areaId, "area_pm");
    eq("activity appended", parked.activity.map((a) => a.op), ["note", "move"]);
    const doc = TM.applyTaskMutation(task, { type: "update", fields: {
      projectId: parked.projectId, cityId: parked.cityId, areaId: parked.areaId, activity: parked.activity,
    } });
    is("per-task move ok", doc.ok);
    eq("per-task id kept", doc.doc.id, "t_move");
    eq("per-task project", doc.doc.projectId, "p2");
    eq("per-task activity", doc.doc.activity.length, 2);
    const fb = createMemoryFirestore();
    fb.seedTeam(team);
    const layer = createLayer(fb, { readLegacyBlob: false });
    const created = await layer.createTask({ ...task, version: 1, status: "todo", priority: "mid", source: "", awaitingReview: false });
    is("per-task create ok", created.ok);
    const viaApi = await layer.moveTaskDoc("t_move", "p2");
    is("moveTaskDoc ok", viaApi.ok);
    const stored = fb._tasks.get("t_move");
    eq("moveTaskDoc id", stored.id, "t_move");
    eq("moveTaskDoc project", stored.projectId, "p2");
    eq("moveTaskDoc city", stored.cityId, "c2");
    eq("moveTaskDoc area", stored.areaId, "area_pm");
    eq("moveTaskDoc activity", stored.activity.map((a) => a.op), ["note", "move"]);
  }

  console.log("");
  console.log(passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
