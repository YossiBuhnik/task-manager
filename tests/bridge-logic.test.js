// Tiny no-dependency tests for bridge/logic.js
// Run: node tests/bridge-logic.test.js
"use strict";

const TMBridge = require("../bridge/logic.js");

let failed = 0;
let passed = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; console.log("  ok  " + name); }
  else { failed++; console.log("  FAIL " + name + "\n       got:      " + a + "\n       expected: " + e); }
}
function is(name, cond) { eq(name, !!cond, true); }

const TOKENS = {
  "tok-michal": { source: "michal-mail", name: "michal" },
  "tok-joe": { source: "joe", name: "joe" },
  "tok-ido": { source: "ido", name: "ido" },
  "tok-shaked": { source: "shaked", name: "shaked" },
};

function handler(opts) {
  const deps = TMBridge.createMemoryDeps(Object.assign({
    tokenMap: TOKENS,
    nowMs: function () { return 1700000000000; },
    mintId: function () { return "t_fixed00001"; },
    migrationDone: true,
  }, opts || {}));
  return { handle: TMBridge.createHandler(deps), deps: deps };
}

function req(over) {
  return Object.assign({
    token: "tok-michal",
    op: "addTask",
    source: "michal-mail",
    idempotencyKey: "michal-mail:msg-1",
    payload: { title: "From mail" },
  }, over);
}

const { handle: H, deps } = handler();

console.log("validation");
eq("unknown op", H({ token: "tok-michal", op: "nope", idempotencyKey: "k", payload: {} }).body.code, "invalid");
eq("missing key", H({ token: "tok-michal", op: "addTask", payload: { title: "x" } }).http, 400);
eq("missing token", H(req({ token: "" })).http, 401);
eq("unknown token", H(req({ token: "nope" })).body.code, "unauthorized");
eq("bad source enum", H(req({ source: "unknown-bot" })).http, 400);
eq("source mismatch is 403", H(req({ token: "tok-ido", source: "michal-mail" })).http, 403);
eq("addTask without title", H(req({ payload: {} })).body.error, "title");
eq("bad due", H(req({ payload: { title: "x", due: "tomorrow" } })).body.code, "invalid");
eq("bad duration", H(req({ payload: { title: "x", durationMin: 10, durationMax: 5 } })).body.code, "invalid");
eq("duration over 14400", H(req({ payload: { title: "x", durationMin: 1, durationMax: 14401 } })).body.error, "duration");
eq("bad durationUnit", H(req({ payload: { title: "x", durationUnit: "week" } })).body.error, "durationUnit");
const dur = handler({ mintId: function () { return "t_dur0000001"; } });
is("duration 14400 with unit ok", dur.handle(req({
  idempotencyKey: "m:long",
  payload: { title: "long", durationMin: 480, durationMax: 14400, durationUnit: "day" },
})).body.ok);
eq("stored duration max", dur.deps.tasks["t_dur0000001"].doc.durationMax, 14400);
eq("stored durationUnit", dur.deps.tasks["t_dur0000001"].doc.durationUnit, "day");
eq("protected field", H(req({ payload: { title: "x", source: "joe" } })).body.error, "protected field");
eq("update without id", H(req({ op: "updateTask", payload: { title: "x" } })).http, 400);
eq("update status done rejected", H(req({
  op: "updateTask", payload: { id: "t_x", status: "done" },
})).body.error, "use markDone");

console.log("authz matrix");
is("bot addTask ok", H(req()).body.ok === true);
eq("forced awaitingReview", deps.tasks["t_fixed00001"].doc.awaitingReview, true);
eq("source stamped", deps.tasks["t_fixed00001"].doc.source, "michal-mail");

deps.tasks["t_q"] = {
  doc: { id: "t_q", title: "q", source: "michal-mail", awaitingReview: true, status: "todo", version: 1 },
  updateTime: "ts-1",
};
is("bot may edit own queued task", H(req({
  op: "updateTask", idempotencyKey: "m:upd1", payload: { id: "t_q", title: "q2" },
})).body.ok);

deps.tasks["t_approved"] = {
  doc: { id: "t_approved", title: "a", source: "michal-mail", awaitingReview: false, status: "todo", version: 1 },
  updateTime: "ts-1",
};
eq("edit after approve is a proposal", H(req({
  op: "updateTask", idempotencyKey: "m:upd2", payload: { id: "t_approved", title: "nope" },
})).body.code, "proposed");
eq("approved title unchanged", deps.tasks["t_approved"].doc.title, "a");

deps.tasks["t_ron"] = {
  doc: { id: "t_ron", title: "r", source: "ron-site", awaitingReview: true, status: "todo", version: 1 },
  updateTime: "ts-1",
};
eq("edit of another bot is a proposal", H(req({
  op: "updateTask", idempotencyKey: "m:upd3", payload: { id: "t_ron", title: "nope" },
})).body.code, "proposed");
eq("other bot title unchanged", deps.tasks["t_ron"].doc.title, "r");

eq("bot cannot markDone", H(req({
  op: "markDone", idempotencyKey: "m:done", payload: { id: "t_q" },
})).http, 403);
eq("bot cannot approve", H(req({
  op: "approveTask", idempotencyKey: "m:appr", payload: { id: "t_q" },
})).http, 403);

is("joe can markDone another's task", H(req({
  token: "tok-joe", source: "joe", op: "markDone",
  idempotencyKey: "joe:done1", payload: { id: "t_ron" },
})).body.ok);
eq("marked done", deps.tasks["t_ron"].doc.status, "done");

is("joe can approve", H(req({
  token: "tok-joe", source: "joe", op: "approveTask",
  idempotencyKey: "joe:appr1", payload: { id: "t_q" },
})).body.ok);
eq("approved", deps.tasks["t_q"].doc.awaitingReview, false);

eq("missing task is 404", H(req({
  token: "tok-joe", source: "joe", op: "markDone",
  idempotencyKey: "joe:miss", payload: { id: "t_nope" },
})).http, 404);

console.log("shaked");
const shaked = handler({ mintId: function () { return "t_shaked0001"; } });
is("shaked addTask ok", shaked.handle(req({
  token: "tok-shaked", source: "shaked", idempotencyKey: "shaked:add1",
  payload: { title: "From shaked" },
})).body.ok);
eq("shaked awaitingReview", shaked.deps.tasks["t_shaked0001"].doc.awaitingReview, true);
eq("shaked cannot markDone", shaked.handle(req({
  token: "tok-shaked", source: "shaked", op: "markDone",
  idempotencyKey: "shaked:done", payload: { id: "t_shaked0001" },
})).http, 403);
eq("shaked cannot approve", shaked.handle(req({
  token: "tok-shaked", source: "shaked", op: "approveTask",
  idempotencyKey: "shaked:appr", payload: { id: "t_shaked0001" },
})).http, 403);
shaked.deps.tasks["t_other"] = {
  doc: { id: "t_other", title: "o", source: "michal-mail", awaitingReview: true, status: "todo", version: 1 },
  updateTime: "ts-1",
};
eq("shaked edit of another bot is a proposal", shaked.handle(req({
  token: "tok-shaked", source: "shaked", op: "updateTask",
  idempotencyKey: "shaked:upd", payload: { id: "t_other", title: "no" },
})).body.code, "proposed");
eq("shaked did not change the other title", shaked.deps.tasks["t_other"].doc.title, "o");

console.log("markDone and setDue replay");
const field = handler();
field.deps.tasks["t_field"] = {
  doc: { id: "t_field", title: "f", source: "ron-site", awaitingReview: true, status: "todo", due: "", version: 1 },
  updateTime: "ts-1",
};
const done1 = field.handle(req({
  token: "tok-joe", source: "joe", op: "markDone",
  idempotencyKey: "joe:field-done", payload: { id: "t_field" },
}));
const doneVersion = field.deps.tasks["t_field"].doc.version;
const doneUpdateTime = field.deps.tasks["t_field"].updateTime;
const doneReplay = field.handle(req({
  token: "tok-joe", source: "joe", op: "markDone",
  idempotencyKey: "joe:field-done", payload: { id: "t_field" },
}));
is("markDone ok", done1.body.ok);
eq("markDone status", field.deps.tasks["t_field"].doc.status, "done");
eq("markDone replay is 200", doneReplay.http, 200);
eq("markDone replay same taskId", doneReplay.body.taskId, "t_field");
eq("markDone replay does not bump version", field.deps.tasks["t_field"].doc.version, doneVersion);
eq("markDone replay does not rewrite", field.deps.tasks["t_field"].updateTime, doneUpdateTime);

field.deps.tasks["t_due"] = {
  doc: { id: "t_due", title: "d", source: "michal-mail", awaitingReview: true, status: "todo", due: "", version: 1 },
  updateTime: "ts-1",
};
const due1 = field.handle(req({
  op: "setDue", idempotencyKey: "michal:due1", payload: { id: "t_due", due: "2026-12-01" },
}));
const dueVersion = field.deps.tasks["t_due"].doc.version;
const dueUpdateTime = field.deps.tasks["t_due"].updateTime;
const dueReplay = field.handle(req({
  op: "setDue", idempotencyKey: "michal:due1", payload: { id: "t_due", due: "2026-12-01" },
}));
is("setDue ok", due1.body.ok);
eq("setDue value", field.deps.tasks["t_due"].doc.due, "2026-12-01");
eq("setDue replay is 200", dueReplay.http, 200);
eq("setDue replay same taskId", dueReplay.body.taskId, "t_due");
eq("setDue replay does not bump version", field.deps.tasks["t_due"].doc.version, dueVersion);
eq("setDue replay does not rewrite", field.deps.tasks["t_due"].updateTime, dueUpdateTime);

console.log("idempotency");
const idemp = handler({ mintId: function () { return "t_idemp00001"; } });
const first = idemp.handle(req({ idempotencyKey: "michal-mail:dup", payload: { title: "One" } }));
const replay = idemp.handle(req({ idempotencyKey: "michal-mail:dup", payload: { title: "One" } }));
is("first write ok", first.body.ok);
eq("replay same fingerprint is 200", replay.http, 200);
eq("replay returns same taskId", replay.body.taskId, first.body.taskId);
eq("no second task for replay", Object.keys(idemp.deps.tasks).filter((id) => idemp.deps.tasks[id].doc.title === "One").length, 1);
eq("different payload same key is 409", idemp.handle(req({
  idempotencyKey: "michal-mail:dup", payload: { title: "Two" },
})).http, 409);

console.log("rate limit");
const rate = {};
let n = 0;
const limited = handler({
  rateLimit: 2, rateBuckets: rate, rateWindowMs: 60000,
  nowMs: function () { return 1000; },
  mintId: function () { n += 1; return "t_rate" + n; },
});
is("rate 1 ok", limited.handle(req({ idempotencyKey: "r1", payload: { title: "a" } })).body.ok);
is("rate 2 ok", limited.handle(req({ idempotencyKey: "r2", payload: { title: "b" } })).body.ok);
eq("rate 3 is 429", limited.handle(req({ idempotencyKey: "r3", payload: { title: "c" } })).http, 429);

console.log("migration flag (safe refuse)");
const pending = handler({ migrationDone: false });
eq("refuses before MIGRATION_DONE", pending.handle(req()).body.code, "migration_pending");
eq("http 403", pending.handle(req({ idempotencyKey: "p2" })).http, 403);
eq("no task written", Object.keys(pending.deps.tasks).length, 0);

console.log("updateTime conflict");
const conf = handler();
conf.deps.tasks["t_c"] = {
  doc: { id: "t_c", title: "c", source: "michal-mail", awaitingReview: true, status: "todo", version: 1 },
  updateTime: "ts-old",
};
const origCommit = conf.deps.commitTask;
conf.deps.commitTask = function (w) {
  // Simulate a stale precondition vs a newer store.
  if (w.updateTime === "ts-old") {
    this.tasks["t_c"].updateTime = "ts-new";
  }
  return origCommit.call(this, w);
}.bind(conf.deps);
// After we bump updateTime, commitTask's own check will see mismatch
eq("stale updateTime is 409", conf.handle(req({
  op: "updateTask", idempotencyKey: "m:conflict", payload: { id: "t_c", title: "newer" },
})).http, 409);

console.log("drive queue expansion");
const ops = TMBridge.expandDriveQueueFile("file123", {
  source: "michal-mail",
  addTasks: [{ title: "A" }, { id: "t_keep", title: "B" }],
  markDone: ["t_1"],
  setDue: [{ id: "t_2", due: "2026-12-01" }],
});
eq("expanded count", ops.length, 4);
eq("add key uses index", ops[0].idempotencyKey, "drive:file123:add:0");
eq("add key uses id", ops[1].idempotencyKey, "drive:file123:add:t_keep");
eq("markDone op", ops[2].op, "markDone");
eq("setDue payload", ops[3].payload, { id: "t_2", due: "2026-12-01" });
is("audit does not include titles", deps.audit.every((a) => !("title" in a) && !("notes" in a) && !("token" in a)));

console.log("proposals");
const prop = handler({ mintId: function () { return "t_prop000001"; } });
prop.deps.tasks["t_own"] = {
  doc: { id: "t_own", title: "own", source: "michal-mail", createdBy: "michal-mail", awaitingReview: true, status: "todo", version: 1 },
  updateTime: "ts-1",
};
prop.deps.tasks["t_other"] = {
  doc: { id: "t_other", title: "other", source: "ron-site", createdBy: "ron-site", awaitingReview: true, status: "todo", due: "", version: 1 },
  updateTime: "ts-1",
};
prop.deps.tasks["t_live"] = {
  doc: { id: "t_live", title: "live", source: "michal-mail", createdBy: "michal-mail", awaitingReview: false, status: "todo", due: "", version: 1, createdAt: "2026-11-01" },
  updateTime: "ts-1",
};
is("own queued update applied", prop.handle(req({
  op: "updateTask", idempotencyKey: "michal:own", payload: { id: "t_own", title: "own2" },
})).body.ok);
eq("own title applied", prop.deps.tasks["t_own"].doc.title, "own2");
const setDueOther = prop.handle(req({
  op: "setDue", idempotencyKey: "michal:due-other", payload: { taskId: "t_other", due: "2026-12-02" },
}));
eq("setDue on another bot is proposed", setDueOther.body.code, "proposed");
eq("other due unchanged", prop.deps.tasks["t_other"].doc.due, "");
eq("edit proposal kind", prop.deps.tasks["t_other"].doc.proposals[0].kind, "edit");
eq("edit proposal by", prop.deps.tasks["t_other"].doc.proposals[0].by, "michal-mail");
const proposedDone = prop.handle(req({
  op: "proposeDone", idempotencyKey: "michal:pd1", payload: { taskId: "t_other", note: "finished on site" },
}));
const proposedReplay = prop.handle(req({
  op: "proposeDone", idempotencyKey: "michal:pd1", payload: { taskId: "t_other", note: "finished on site" },
}));
eq("proposeDone proposed", proposedDone.body.code, "proposed");
eq("proposeDone status unchanged", prop.deps.tasks["t_other"].doc.status, "todo");
eq("proposeDone one proposal of kind done", prop.deps.tasks["t_other"].doc.proposals.filter((p) => p.kind === "done").length, 1);
eq("proposeDone replay same id", proposedReplay.body.proposalId, proposedDone.body.proposalId);
eq("proposeDone replay does not duplicate", prop.deps.tasks["t_other"].doc.proposals.filter((p) => p.kind === "done").length, 1);
eq("bot cannot accept", prop.handle(req({
  op: "acceptProposal", idempotencyKey: "michal:acc", payload: { taskId: "t_other", proposalId: proposedDone.body.proposalId },
})).http, 403);
eq("bot cannot reject", prop.handle(req({
  op: "rejectProposal", idempotencyKey: "michal:rej", payload: { taskId: "t_other", proposalId: proposedDone.body.proposalId },
})).http, 403);
const accepted = prop.handle(req({
  token: "tok-joe", source: "joe", op: "acceptProposal", idempotencyKey: "joe:acc-done",
  payload: { taskId: "t_other", proposalId: proposedDone.body.proposalId },
}));
const acceptedReplay = prop.handle(req({
  token: "tok-joe", source: "joe", op: "acceptProposal", idempotencyKey: "joe:acc-done",
  payload: { taskId: "t_other", proposalId: proposedDone.body.proposalId },
}));
is("joe accept ok", accepted.body.ok);
eq("accept marks done", prop.deps.tasks["t_other"].doc.status, "done");
eq("accept replay same task", acceptedReplay.body.taskId, "t_other");
eq("accept replay does not add proposals", prop.deps.tasks["t_other"].doc.proposals.filter((p) => p.kind === "done").length, 1);
const editProp = prop.deps.tasks["t_live"].doc;
const edit = prop.handle(req({
  op: "updateTask", idempotencyKey: "michal:edit-live", payload: { id: "t_live", title: "changed" },
}));
eq("approved own task is proposal", edit.body.code, "proposed");
eq("approved title unchanged", prop.deps.tasks["t_live"].doc.title, "live");
eq("joe rejects edit", prop.handle(req({
  token: "tok-joe", source: "joe", op: "rejectProposal", idempotencyKey: "joe:rej-edit",
  payload: { taskId: "t_live", proposalId: edit.body.proposalId },
})).body.code, "ok");
eq("rejected title still unchanged", prop.deps.tasks["t_live"].doc.title, "live");
eq("proposal rejected", prop.deps.tasks["t_live"].doc.proposals[0].state, "rejected");
is("joe setDue applies", prop.handle(req({
  token: "tok-joe", source: "joe", op: "setDue", idempotencyKey: "joe:due-live",
  payload: { id: "t_live", due: "2026-12-03" },
})).body.ok);
eq("joe due applied", prop.deps.tasks["t_live"].doc.due, "2026-12-03");

console.log("listTasks");
prop.deps.tasks["t_a"] = { doc: { id: "t_a", title: "A", status: "todo", due: "", areaId: "area_office", projectId: "p1", awaitingReview: true, createdAt: "2026-11-01", proposals: [{ state: "pending" }] }, updateTime: "ts" };
prop.deps.tasks["t_b"] = { doc: { id: "t_b", title: "B", status: "done", due: "2026-12-01", areaId: "area_pm", projectId: "p2", awaitingReview: false, createdAt: "2026-11-20" }, updateTime: "ts" };
prop.deps.tasks["t_c"] = { doc: { id: "t_c", title: "C", status: "todo", due: "", areaId: "area_office", projectId: "p1", awaitingReview: false, createdAt: "2026-10-01" }, updateTime: "ts" };
const page1 = prop.handle(req({ op: "listTasks", idempotencyKey: "", payload: { status: "todo", area: "area_office", limit: 1 } }));
eq("listTasks http", page1.http, 200);
eq("listTasks page size", page1.body.tasks.length, 1);
eq("listTasks first id", page1.body.tasks[0].id, "t_a");
eq("listTasks proposals count", page1.body.tasks[0].proposals, 1);
eq("listTasks has cursor", typeof page1.body.nextCursor, "string");
const page2 = prop.handle(req({ op: "listTasks", idempotencyKey: "michal:list2", payload: { status: "todo", area: "area_office", limit: 1, cursor: page1.body.nextCursor } }));
eq("listTasks second page", page2.body.tasks.map((t) => t.id), ["t_c"]);
eq("listTasks since filters", prop.handle(req({
  op: "listTasks", idempotencyKey: "michal:since", payload: { since: "2026-11-15", limit: 10 },
})).body.tasks.some((t) => t.id === "t_c"), false);
const blocked = handler({ migrationDone: false });
eq("listTasks migration pending", blocked.handle(req({ op: "listTasks", payload: {} })).body.code, "migration_pending");
eq("listTasks migration http", blocked.handle(req({ op: "listTasks", idempotencyKey: "x", payload: {} })).http, 403);

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
