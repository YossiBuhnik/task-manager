// bridge/logic.js — pure bot-write logic (no Apps Script, no secrets).
// Used by tests in Node and by Code.gs (copied into the Apps Script project
// as Logic.gs so TMBridge is a global).
(function (root) {
  "use strict";

  var OPS = ["addTask", "updateTask", "markDone", "setDue", "approveTask", "proposeDone", "acceptProposal", "rejectProposal", "listTasks", "listRefs", "listCorrections"];
  var BOT_SOURCES = ["michal-mail", "ron-site", "noga-tour", "joe", "ido", "shaked", "calendar-agent"];
  var STATUSES = ["todo", "doing", "done"];
  var PRIORITIES = ["high", "mid", "low"];
  var PROTECTED = { source: 1, createdBy: 1, owner: 1, visibility: 1, corrections: 1 };
  var CORRECTION_KINDS = { date: 1, owner: 1, wording: 1, scope: 1, duplicate: 1, other: 1 };
  var CORRECTIONS_CAP = 20;
  var DEFAULT_RATE_LIMIT = 60;
  var DEFAULT_RATE_WINDOW_MS = 60000;
  var IDEMPOTENCY_MAX_LEN = 200;

  function isAdminSource(source) {
    return source === "joe" || source === "yossi";
  }

  function httpError(http, code, error) {
    return { http: http, body: { ok: false, code: code, error: error || code } };
  }

  function httpOk(taskId, extra) {
    var body = { ok: true, code: "ok" };
    if (taskId) body.taskId = taskId;
    if (extra) {
      for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) body[k] = extra[k];
    }
    return { http: 200, body: body };
  }

  function isIsoDateOrEmpty(s) {
    return s === "" || (typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s));
  }

  var DURATION_MAX = 14400;
  var DURATION_UNITS = { min: 1, hour: 1, day: 1 };

  function isValidDuration(min, max) {
    return Number.isInteger(min) && Number.isInteger(max) && min >= 1 && max <= DURATION_MAX && min <= max;
  }

  function isValidDurationUnit(unit) {
    return unit == null || unit === "" || DURATION_UNITS[unit] === 1;
  }

  function durationOf(payload) {
    var min = payload.durationMin;
    var max = payload.durationMax;
    if (min == null && max == null) {
      var d = payload.duration == null ? 60 : Number(payload.duration);
      min = max = Number.isInteger(d) ? d : 60;
    }
    min = Number(min);
    max = Number(max);
    return { durationMin: min, durationMax: max };
  }

  function lookupToken(token, tokenMap) {
    if (!token || typeof token !== "string") return null;
    return tokenMap && tokenMap[token] ? tokenMap[token] : null;
  }

  function extractToken(body, headers) {
    if (body && typeof body.token === "string" && body.token) return body.token;
    var h = headers && (headers.Authorization || headers.authorization);
    if (typeof h === "string" && /^Bearer\s+/i.test(h)) return h.replace(/^Bearer\s+/i, "").trim();
    return "";
  }

  function validateRequest(body, actor) {
    if (!body || typeof body !== "object") return { error: httpError(400, "invalid", "body") };
    if (OPS.indexOf(body.op) === -1) return { error: httpError(400, "invalid", "op") };
    var key = body.idempotencyKey;
    var readOp = body.op === "listTasks" || body.op === "listRefs" || body.op === "listCorrections";
    if (readOp) {
      if (key != null && key !== "" && (typeof key !== "string" || !key.trim() || key.length > IDEMPOTENCY_MAX_LEN)) {
        return { error: httpError(400, "invalid", "idempotencyKey") };
      }
      key = key || "";
    } else if (!key || typeof key !== "string" || !key.trim() || key.length > IDEMPOTENCY_MAX_LEN) {
      return { error: httpError(400, "invalid", "idempotencyKey") };
    }
    var source = body.source != null && body.source !== "" ? body.source : actor.source;
    if (BOT_SOURCES.indexOf(source) === -1 && !isAdminSource(source)) {
      return { error: httpError(400, "invalid", "source") };
    }
    if (!isAdminSource(actor.source) && source !== actor.source) {
      return { error: httpError(403, "forbidden", "source mismatch") };
    }
    var payload = body.payload || {};
    if (typeof payload !== "object") return { error: httpError(400, "invalid", "payload") };
    if (!isValidDurationUnit(payload.durationUnit)) {
      return { error: httpError(400, "invalid", "durationUnit") };
    }
    if (!readOp) {
      for (var k in payload) {
        if (PROTECTED[k] && payload[k] !== undefined) {
          return { error: httpError(400, "invalid", "protected field") };
        }
      }
    }
    if (body.op === "addTask") {
      if (!payload.title || typeof payload.title !== "string" || !payload.title.trim()) {
        return { error: httpError(400, "invalid", "title") };
      }
      if (payload.status != null && STATUSES.indexOf(payload.status) === -1) {
        return { error: httpError(400, "invalid", "status") };
      }
      if (payload.priority != null && PRIORITIES.indexOf(payload.priority) === -1) {
        return { error: httpError(400, "invalid", "priority") };
      }
      if (payload.due != null && !isIsoDateOrEmpty(payload.due)) {
        return { error: httpError(400, "invalid", "due") };
      }
      var dur = durationOf(payload);
      if (!isValidDuration(dur.durationMin, dur.durationMax)) {
        return { error: httpError(400, "invalid", "duration") };
      }
    }
    if (body.op === "updateTask" || body.op === "markDone" || body.op === "setDue" || body.op === "approveTask" || body.op === "proposeDone" || body.op === "acceptProposal" || body.op === "rejectProposal") {
      var tid = payload.taskId || payload.id;
      if (!tid || typeof tid !== "string") return { error: httpError(400, "invalid", "id") };
      payload.id = tid;
    }
    if (body.op === "proposeDone" && payload.note != null && typeof payload.note !== "string") {
      return { error: httpError(400, "invalid", "note") };
    }
    if ((body.op === "acceptProposal" || body.op === "rejectProposal") && (!payload.proposalId || typeof payload.proposalId !== "string")) {
      return { error: httpError(400, "invalid", "proposalId") };
    }
    if (body.op === "updateTask") {
      if (payload.status === "done") return { error: httpError(400, "invalid", "use markDone") };
      if (payload.status != null && STATUSES.indexOf(payload.status) === -1) {
        return { error: httpError(400, "invalid", "status") };
      }
      if (payload.priority != null && PRIORITIES.indexOf(payload.priority) === -1) {
        return { error: httpError(400, "invalid", "priority") };
      }
      if (payload.due != null && !isIsoDateOrEmpty(payload.due)) {
        return { error: httpError(400, "invalid", "due") };
      }
      if (payload.durationMin != null || payload.durationMax != null) {
        var d2 = durationOf(payload);
        if (!isValidDuration(d2.durationMin, d2.durationMax)) {
          return { error: httpError(400, "invalid", "duration") };
        }
      }
    }
    if (body.op === "setDue" && !isIsoDateOrEmpty(payload.due == null ? "" : payload.due)) {
      return { error: httpError(400, "invalid", "due") };
    }
    return { ok: true, source: source, payload: payload, op: body.op, idempotencyKey: key };
  }

  function ownsTask(actor, existing) {
    if (!existing || !actor) return false;
    if (existing.createdBy && existing.createdBy === actor.source) return true;
    return existing.source === actor.source;
  }

  function authorize(actor, op, existing) {
    if (op === "addTask" || op === "listTasks" || op === "listRefs" || op === "listCorrections") return { ok: true };
    if (!existing) return { error: httpError(404, "not_found") };
    if (op === "acceptProposal" || op === "rejectProposal" || op === "markDone" || op === "approveTask") {
      if (!isAdminSource(actor.source)) return { error: httpError(403, "forbidden", "admin only") };
      return { ok: true };
    }
    if (op === "proposeDone") return { ok: true };
    if (op === "updateTask" || op === "setDue") {
      if (isAdminSource(actor.source)) return { ok: true };
      if (ownsTask(actor, existing) && existing.awaitingReview) return { ok: true };
      return { ok: true, propose: true };
    }
    if (isAdminSource(actor.source)) return { ok: true };
    if (!ownsTask(actor, existing)) return { error: httpError(403, "forbidden", "other bot's task") };
    if (!existing.awaitingReview) return { error: httpError(403, "forbidden", "already approved") };
    return { ok: true };
  }

  function fnv1aHex(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    var hex = h.toString(16);
    while (hex.length < 8) hex = "0" + hex;
    return hex;
  }

  function idempotencyId(source, key) {
    return "idemp_" + fnv1aHex(String(source) + ":" + String(key)) + fnv1aHex(":" + String(key));
  }

  function stableStringify(v) {
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
    var keys = Object.keys(v).sort();
    return "{" + keys.map(function (k) { return JSON.stringify(k) + ":" + stableStringify(v[k]); }).join(",") + "}";
  }

  function requestFingerprint(op, source, payload) {
    return fnv1aHex(stableStringify({ op: op, source: source, payload: payload || {} }));
  }

  function checkRateLimit(bucketMap, tokenId, nowMs, limit, windowMs) {
    limit = limit == null ? DEFAULT_RATE_LIMIT : limit;
    windowMs = windowMs == null ? DEFAULT_RATE_WINDOW_MS : windowMs;
    var start = nowMs - windowMs;
    var arr = (bucketMap[tokenId] || []).filter(function (t) { return t > start; });
    if (arr.length >= limit) {
      bucketMap[tokenId] = arr;
      return { ok: false, error: httpError(429, "rate_limited") };
    }
    arr.push(nowMs);
    bucketMap[tokenId] = arr;
    return { ok: true };
  }

  function mintTaskId() {
    var chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    var s = "t_";
    for (var i = 0; i < 11; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
    return s;
  }

  function buildAddTask(payload, source, actor, id) {
    var dur = durationOf(payload);
    var doc = {
      id: id,
      title: payload.title.trim(),
      status: payload.status && payload.status !== "done" ? payload.status : "todo",
      priority: payload.priority || "mid",
      due: payload.due || "",
      durationMin: dur.durationMin,
      durationMax: dur.durationMax,
      duration: payload.duration != null ? payload.duration : dur.durationMin,
      source: source,
      awaitingReview: true,
      createdBy: actor.name || actor.source || source,
      projectId: payload.projectId || "",
      cityId: payload.cityId || "",
      areaId: payload.areaId || "",
      notes: payload.notes || "",
      assignee: payload.assignee || "",
      time: payload.time || "",
      version: 1,
    };
    if (payload.durationUnit) doc.durationUnit = payload.durationUnit;
    return doc;
  }

  function applyUpdateFields(existing, payload) {
    var next = {};
    for (var k in existing) if (Object.prototype.hasOwnProperty.call(existing, k)) next[k] = existing[k];
    for (var f in payload) {
      if (!Object.prototype.hasOwnProperty.call(payload, f)) continue;
      if (PROTECTED[f] || f === "awaitingReview") continue;
      next[f] = payload[f];
    }
    if (payload.durationMin != null || payload.durationMax != null) {
      var dur = durationOf(payload);
      next.durationMin = dur.durationMin;
      next.durationMax = dur.durationMax;
    }
    next.id = existing.id;
    next.source = existing.source;
    next.createdBy = existing.createdBy;
    next.owner = existing.owner;
    next.visibility = existing.visibility;
    next.version = (existing.version || 1) + 1;
    return next;
  }

  // Drive queue file → per-item operations (each with its own idempotencyKey).
  function expandDriveQueueFile(fileId, file) {
    var source = (file && file.source) || "";
    var out = [];
    var i, item, keyBase = "drive:" + fileId + ":";
    var adds = (file && file.addTasks) || [];
    for (i = 0; i < adds.length; i++) {
      item = adds[i];
      out.push({
        op: "addTask",
        source: source,
        idempotencyKey: keyBase + "add:" + (item.id || i),
        payload: item,
      });
    }
    var done = (file && file.markDone) || [];
    for (i = 0; i < done.length; i++) {
      out.push({
        op: "markDone",
        source: source,
        idempotencyKey: keyBase + "done:" + done[i],
        payload: { id: done[i] },
      });
    }
    var dues = (file && file.setDue) || [];
    for (i = 0; i < dues.length; i++) {
      item = dues[i];
      out.push({
        op: "setDue",
        source: source,
        idempotencyKey: keyBase + "due:" + item.id,
        payload: { id: item.id, due: item.due },
      });
    }
    return out;
  }

  function pendingCount(doc) {
    var n = 0;
    var list = (doc && doc.proposals) || [];
    for (var i = 0; i < list.length; i++) if (!list[i].state || list[i].state === "pending") n++;
    return n;
  }

  function proposalListOf(doc) {
    var list = (doc && doc.proposals) || [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i] || {};
      out.push({
        id: p.id,
        kind: p.kind,
        by: p.by,
        at: p.at,
        state: p.state || "pending",
      });
    }
    return out;
  }

  function summarizeTask(doc) {
    var pending = pendingCount(doc);
    var areaId = doc.areaId || "";
    var projectId = doc.projectId || "";
    var cityId = doc.cityId || "";
    return {
      id: doc.id,
      title: doc.title || "",
      status: doc.status || "",
      due: doc.due || "",
      durationMin: doc.durationMin,
      durationMax: doc.durationMax,
      durationUnit: doc.durationUnit || "",
      areaId: areaId,
      projectId: projectId,
      cityId: cityId,
      area: areaId || doc.area || "",
      project: projectId || doc.project || "",
      awaitingReview: doc.awaitingReview === true,
      proposals: pending,
      proposalsPending: pending,
      proposalList: proposalListOf(doc),
      corrections: doc.corrections || [],
    };
  }

  function hiddenRefIndex(state) {
    var areas = {};
    var cities = {};
    var projects = {};
    if (!state) return { areas: areas, cities: cities, projects: projects };
    var i, c, p, j;
    var areaList = state.areas || [];
    for (i = 0; i < areaList.length; i++) {
      if (areaList[i] && areaList[i].id && areaList[i].visibility === "private") areas[areaList[i].id] = 1;
    }
    var cityList = state.cities || [];
    for (i = 0; i < cityList.length; i++) {
      c = cityList[i];
      if (!c || !c.id) continue;
      if (c.visibility === "private" || areas[c.areaId]) cities[c.id] = 1;
      var projs = c.projects || [];
      for (j = 0; j < projs.length; j++) {
        p = projs[j];
        if (!p || !p.id) continue;
        if (p.visibility === "private" || cities[c.id] || areas[c.areaId]) projects[p.id] = 1;
      }
    }
    return { areas: areas, cities: cities, projects: projects };
  }

  function taskHiddenFrom(actor, doc, state) {
    if (!doc || isAdminSource(actor && actor.source)) return false;
    if (doc.visibility === "private") return true;
    if (!state) return false;
    var idx = hiddenRefIndex(state);
    if (doc.areaId && idx.areas[doc.areaId]) return true;
    if (doc.cityId && idx.cities[doc.cityId]) return true;
    if (doc.projectId && idx.projects[doc.projectId]) return true;
    return false;
  }

  function dueInRange(due, query) {
    if (!query.dueFrom && !query.dueTo) return true;
    if (!due) return false;
    if (query.dueFrom && String(due) < String(query.dueFrom)) return false;
    if (query.dueTo && String(due) > String(query.dueTo)) return false;
    return true;
  }

  function listTaskSummaries(docs, query, actor, state) {
    query = query || {};
    var limit = query.limit == null ? 50 : Math.max(1, Math.min(100, Number(query.limit) || 50));
    var rows = [];
    for (var i = 0; i < docs.length; i++) {
      var d = docs[i];
      if (!d) continue;
      if (taskHiddenFrom(actor, d, state)) continue;
      if (query.status && d.status !== query.status) continue;
      var area = d.areaId || d.area || "";
      if (query.area && area !== query.area) continue;
      if (query.awaitingReview === true || query.awaitingReview === false) {
        if ((d.awaitingReview === true) !== query.awaitingReview) continue;
      }
      if (query.source && (d.source || "") !== query.source) continue;
      if (!dueInRange(d.due, query)) continue;
      if (query.since) {
        var stamp = d.updatedAt || d.createdAt || "";
        if (String(stamp) < String(query.since)) continue;
      }
      rows.push(d);
    }
    rows.sort(function (a, b) {
      var x = String(a.id);
      var y = String(b.id);
      return x < y ? -1 : x > y ? 1 : 0;
    });
    if (query.cursor) rows = rows.filter(function (d) { return String(d.id) > String(query.cursor); });
    var page = rows.slice(0, limit);
    return {
      tasks: page.map(summarizeTask),
      nextCursor: rows.length > limit ? page[page.length - 1].id : null,
    };
  }

  function isPrivateRef(item) {
    return !!(item && item.visibility === "private");
  }

  // Areas, cities, and projects still live on the teams/main state blob.
  // This read never writes that blob. Non-admin tokens omit private areas
  // and the cities/projects under them, plus private projects.
  function publicRefs(state, actor) {
    var admin = isAdminSource(actor && actor.source);
    var areas = [];
    var cities = [];
    var projects = [];
    var hidden = {};
    var list = (state && state.areas) || [];
    var i, a, c, p, citiesIn;
    for (i = 0; i < list.length; i++) {
      a = list[i];
      if (!a || !a.id) continue;
      if (!admin && isPrivateRef(a)) { hidden[a.id] = 1; continue; }
      areas.push({ id: a.id, name: a.name || "" });
    }
    citiesIn = (state && state.cities) || [];
    for (i = 0; i < citiesIn.length; i++) {
      c = citiesIn[i];
      if (!c || !c.id) continue;
      if (!admin && (hidden[c.areaId] || isPrivateRef(c))) continue;
      cities.push({ id: c.id, name: c.name || "", areaId: c.areaId || "" });
      var projs = c.projects || [];
      for (var j = 0; j < projs.length; j++) {
        p = projs[j];
        if (!p || !p.id) continue;
        if (!admin && isPrivateRef(p)) continue;
        projects.push({ id: p.id, name: p.name || "", cityId: c.id, areaId: c.areaId || "" });
      }
    }
    return { areas: areas, cities: cities, projects: projects };
  }

  function proposalIdFor(source, key) {
    return "prop_" + fnv1aHex(String(source) + ":" + String(key));
  }

  function isBotCreated(doc) {
    if (!doc) return false;
    if (BOT_SOURCES.indexOf(doc.source) !== -1) return true;
    return BOT_SOURCES.indexOf(doc.createdBy) !== -1;
  }

  function parseCorrectionReason(raw, required) {
    if (raw == null || raw === "") {
      if (required) return { error: httpError(400, "invalid", "correctionReason required") };
      return { value: null };
    }
    if (typeof raw !== "object" || Array.isArray(raw)) return { error: httpError(400, "invalid", "correctionReason") };
    if (!CORRECTION_KINDS[raw.kind]) return { error: httpError(400, "invalid", "kind") };
    if (typeof raw.reason !== "string") return { error: httpError(400, "invalid", "reason") };
    var reason = raw.reason.trim();
    if (!reason || reason.length > 500) return { error: httpError(400, "invalid", "reason") };
    return { value: { kind: raw.kind, reason: reason } };
  }

  function changedFields(op, payload) {
    if (op === "setDue") return { due: payload.due || "" };
    var out = {};
    for (var k in payload) {
      if (!Object.prototype.hasOwnProperty.call(payload, k)) continue;
      if (k === "id" || k === "taskId" || k === "correctionReason") continue;
      out[k] = payload[k];
    }
    return out;
  }

  function snapshot(existing, fields) {
    var before = {};
    var after = {};
    for (var k in fields) {
      if (!Object.prototype.hasOwnProperty.call(fields, k)) continue;
      before[k] = existing[k];
      after[k] = fields[k];
    }
    return { before: before, after: after };
  }

  function appendCorrection(doc, entry) {
    var list = (doc.corrections || []).slice();
    list.push(entry);
    if (list.length > CORRECTIONS_CAP) list = list.slice(list.length - CORRECTIONS_CAP);
    doc.corrections = list;
  }

  function applyDirect(existing, op, payload, actor, now) {
    var fields;
    if (op === "markDone") fields = { status: "done" };
    else if (op === "setDue") fields = { due: payload.due || "" };
    else if (op === "approveTask") {
      var approved = applyUpdateFields(existing, {});
      approved.awaitingReview = false;
      approved.version = (existing.version || 1) + 1;
      return { doc: approved };
    } else fields = changedFields(op, payload);

    var record = null;
    if (op === "updateTask" || op === "setDue") {
      var required = isAdminSource(actor.source) && isBotCreated(existing) && existing.awaitingReview === true;
      var parsed = parseCorrectionReason(payload.correctionReason, required);
      if (parsed.error) return parsed;
      if (parsed.value && isAdminSource(actor.source)) {
        var shot = snapshot(existing, fields);
        record = {
          at: new Date(now).toISOString(),
          by: actor.source,
          op: op,
          fields: shot.after,
          before: shot.before,
          after: shot.after,
          reason: parsed.value.reason,
          kind: parsed.value.kind,
        };
      }
    }
    var doc = applyUpdateFields(existing, fields);
    if (record) appendCorrection(doc, record);
    return { doc: doc };
  }

  function listCorrections(docs, query, actor, state) {
    query = query || {};
    var source = query.source;
    if (!source || typeof source !== "string") return { error: httpError(400, "invalid", "source") };
    if (!isAdminSource(actor.source) && source !== actor.source) {
      return { error: httpError(403, "forbidden", "source") };
    }
    var limit = query.limit == null ? 50 : Math.max(1, Math.min(200, Number(query.limit) || 50));
    var rows = [];
    for (var i = 0; i < docs.length; i++) {
      var d = docs[i];
      if (!d || d.source !== source) continue;
      if (taskHiddenFrom(actor, d, state)) continue;
      var list = d.corrections || [];
      for (var j = 0; j < list.length; j++) {
        var c = list[j];
        if (!c) continue;
        if (query.since && String(c.at || "") < String(query.since)) continue;
        var key = String(c.at || "") + "\t" + String(d.id) + "\t" + j;
        rows.push({
          key: key,
          entry: {
            taskId: d.id,
            at: c.at,
            by: c.by,
            op: c.op,
            fields: c.fields,
            before: c.before,
            after: c.after,
            reason: c.reason,
            kind: c.kind,
          },
        });
      }
    }
    rows.sort(function (a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; });
    if (query.cursor) rows = rows.filter(function (r) { return r.key > String(query.cursor); });
    var page = rows.slice(0, limit);
    return {
      corrections: page.map(function (r) { return r.entry; }),
      nextCursor: rows.length > limit ? page[page.length - 1].key : null,
    };
  }

  function editFieldsOf(op, payload) {
    if (op === "setDue") return { due: payload.due || "" };
    var out = {};
    for (var k in payload) {
      if (!Object.prototype.hasOwnProperty.call(payload, k)) continue;
      if (k === "id" || k === "taskId") continue;
      out[k] = payload[k];
    }
    return out;
  }

  function withProposal(existing, proposal) {
    var list = (existing.proposals || []).slice();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === proposal.id) return applyUpdateFields(existing, {});
    }
    list.push(proposal);
    var next = applyUpdateFields(existing, {});
    next.proposals = list;
    return next;
  }

  function setProposalState(existing, proposalId, state) {
    var list = (existing.proposals || []).slice();
    var found = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === proposalId) {
        found = {};
        for (var k in list[i]) if (Object.prototype.hasOwnProperty.call(list[i], k)) found[k] = list[i][k];
        found.state = state;
        list[i] = found;
      }
    }
    return { list: list, proposal: found };
  }

  // deps:
  //   nowMs, tokenMap, rateBuckets, rateLimit,
  //   migrationDone (boolean),
  //   mintId(),
  //   getTask(id) -> { doc, updateTime } | null
  //   commitTask({ type, id, doc, updateTime })  // type: create|update; throws { code:"conflict" }
  //   getIdempotency(id), putIdempotency(id, rec),
  //   appendAudit(rec)
  function createHandler(deps) {
    deps = deps || {};
    var buckets = deps.rateBuckets || {};

    return function handleRequest(rawOrBody, headers) {
      var body = rawOrBody;
      if (typeof rawOrBody === "string") {
        try { body = JSON.parse(rawOrBody || "{}"); }
        catch (e) { return httpError(400, "invalid", "json"); }
      }
      var token = extractToken(body, headers || {});
      var actor = lookupToken(token, deps.tokenMap);
      if (!actor) return httpError(401, "unauthorized");

      var now = deps.nowMs ? deps.nowMs() : Date.now();
      var rl = checkRateLimit(buckets, token, now, deps.rateLimit, deps.rateWindowMs);
      if (!rl.ok) return rl.error;

      if (!deps.migrationDone) {
        return httpError(403, "migration_pending", "bridge writes are disabled until MIGRATION_DONE is set");
      }

      var checked = validateRequest(body, actor);
      if (checked.error) return checked.error;

      var idempId = checked.idempotencyKey ? idempotencyId(checked.source, checked.idempotencyKey) : "";
      var fp = requestFingerprint(checked.op, checked.source, checked.payload);
      var prev = idempId && deps.getIdempotency && deps.getIdempotency(idempId);
      if (prev) {
        if (prev.fingerprint !== fp) return httpError(409, "conflict", "idempotency key reused");
        return { http: 200, body: prev.response };
      }

      var existing = null;
      var existingMeta = null;
      if (checked.op !== "addTask" && checked.op !== "listTasks" && checked.op !== "listRefs" && checked.op !== "listCorrections") {
        existingMeta = deps.getTask ? deps.getTask(checked.payload.id) : null;
        existing = existingMeta && existingMeta.doc;
        if (!existing) return httpError(404, "not_found");
      }

      var authz = authorize(actor, checked.op, existing);
      if (authz.error) return authz.error;

      var taskId, doc, result, listed, marked, proposal;
      try {
        if (checked.op === "listTasks") {
          var all = deps.listTasks ? deps.listTasks() : [];
          var teamForTasks = deps.getTeamState ? deps.getTeamState() : null;
          listed = listTaskSummaries(all, checked.payload, actor, teamForTasks);
          result = { http: 200, body: { ok: true, code: "ok", tasks: listed.tasks, nextCursor: listed.nextCursor } };
        } else if (checked.op === "listRefs") {
          var state = deps.getTeamState ? deps.getTeamState() : { areas: [], cities: [] };
          var refs = publicRefs(state, actor);
          result = { http: 200, body: { ok: true, code: "ok", areas: refs.areas, cities: refs.cities, projects: refs.projects } };
        } else if (checked.op === "listCorrections") {
          var corrDocs = deps.listTasks ? deps.listTasks() : [];
          var corrState = deps.getTeamState ? deps.getTeamState() : null;
          var corr = listCorrections(corrDocs, checked.payload, actor, corrState);
          if (corr.error) return corr.error;
          result = { http: 200, body: { ok: true, code: "ok", corrections: corr.corrections, nextCursor: corr.nextCursor } };
        } else if (checked.op === "addTask") {
          taskId = (checked.payload.id && /^t_/.test(checked.payload.id)) ? checked.payload.id : (deps.mintId || mintTaskId)();
          if (deps.getTask && deps.getTask(taskId)) return httpError(409, "conflict", "id exists");
          doc = buildAddTask(checked.payload, checked.source, actor, taskId);
          if (doc.createdAt == null) doc.createdAt = new Date(now).toISOString().slice(0, 10);
          deps.commitTask({ type: "create", id: taskId, doc: doc });
          result = httpOk(taskId);
        } else if (checked.op === "proposeDone" || authz.propose) {
          taskId = existing.id;
          proposal = {
            id: proposalIdFor(checked.source, checked.idempotencyKey),
            kind: checked.op === "proposeDone" ? "done" : "edit",
            by: checked.source,
            at: new Date(now).toISOString(),
            idempotencyKey: checked.idempotencyKey,
            state: "pending",
          };
          if (checked.op === "proposeDone") {
            if (checked.payload.note) proposal.note = checked.payload.note;
          } else proposal.fields = editFieldsOf(checked.op, checked.payload);
          doc = withProposal(existing, proposal);
          deps.commitTask({
            type: "update",
            id: taskId,
            doc: doc,
            updateTime: existingMeta && existingMeta.updateTime,
          });
          result = httpOk(taskId, { code: "proposed", proposalId: proposal.id });
        } else if (checked.op === "acceptProposal" || checked.op === "rejectProposal") {
          taskId = existing.id;
          var nextState = checked.op === "acceptProposal" ? "accepted" : "rejected";
          marked = setProposalState(existing, checked.payload.proposalId, nextState);
          if (!marked.proposal || marked.proposal.state === "pending") return httpError(404, "not_found", "proposal");
          if (marked.proposal.state !== "pending" && existing.proposals) {
            var prior = null;
            for (var pi = 0; pi < existing.proposals.length; pi++) {
              if (existing.proposals[pi].id === checked.payload.proposalId) prior = existing.proposals[pi];
            }
            if (!prior || prior.state !== "pending") return httpError(409, "conflict", "proposal");
          }
          if (checked.op === "acceptProposal" && marked.proposal.kind === "done") {
            doc = applyUpdateFields(existing, { status: "done" });
          } else if (checked.op === "acceptProposal") {
            doc = applyUpdateFields(existing, marked.proposal.fields || {});
          } else {
            doc = applyUpdateFields(existing, {});
          }
          doc.proposals = marked.list;
          deps.commitTask({
            type: "update",
            id: taskId,
            doc: doc,
            updateTime: existingMeta && existingMeta.updateTime,
          });
          result = httpOk(taskId);
        } else {
          taskId = existing.id;
          var applied = applyDirect(existing, checked.op, checked.payload, actor, now);
          if (applied.error) return applied.error;
          doc = applied.doc;
          deps.commitTask({
            type: "update",
            id: taskId,
            doc: doc,
            updateTime: existingMeta && existingMeta.updateTime,
          });
          result = httpOk(taskId);
        }
      } catch (err) {
        var code = err && err.code;
        if (code === "conflict") return httpError(409, "conflict", "version");
        if (code === "not_found") return httpError(404, "not_found");
        return httpError(500, "internal");
      }

      if (!result) result = httpOk(taskId);
      if (idempId && deps.putIdempotency) {
        deps.putIdempotency(idempId, {
          source: checked.source,
          idempotencyKey: checked.idempotencyKey,
          op: checked.op,
          taskId: taskId,
          status: "ok",
          fingerprint: fp,
          response: result.body,
          createdAt: now,
        });
      }
      if (deps.appendAudit) {
        deps.appendAudit({
          at: now,
          source: checked.source,
          op: checked.op,
          taskId: taskId,
          idempotencyKey: checked.idempotencyKey,
          result: "ok",
        });
      }
      return result;
    };
  }

  function createMemoryDeps(opts) {
    opts = opts || {};
    var tasks = opts.tasks || {};
    var teamState = opts.teamState || { areas: [], cities: [] };
    var idemp = {};
    var audit = [];
    var clocks = { t: 1 };
    return {
      nowMs: opts.nowMs || function () { return Date.now(); },
      tokenMap: opts.tokenMap || {},
      rateBuckets: opts.rateBuckets || {},
      rateLimit: opts.rateLimit,
      migrationDone: opts.migrationDone !== false,
      mintId: opts.mintId,
      tasks: tasks,
      audit: audit,
      idempotency: idemp,
      getTask: function (id) { return tasks[id] ? { doc: tasks[id].doc, updateTime: tasks[id].updateTime } : null; },
      listTasks: function () {
        var out = [];
        for (var id in tasks) if (tasks[id] && tasks[id].doc) out.push(tasks[id].doc);
        return out;
      },
      getTeamState: function () { return teamState; },
      commitTask: function (w) {
        var cur = tasks[w.id];
        if (w.type === "create") {
          if (cur) { var e1 = new Error("exists"); e1.code = "conflict"; throw e1; }
          tasks[w.id] = { doc: w.doc, updateTime: "ts-" + (++clocks.t) };
          return;
        }
        if (!cur) { var e2 = new Error("missing"); e2.code = "not_found"; throw e2; }
        if (w.updateTime && cur.updateTime !== w.updateTime) {
          var e3 = new Error("updateTime"); e3.code = "conflict"; throw e3;
        }
        tasks[w.id] = { doc: w.doc, updateTime: "ts-" + (++clocks.t) };
      },
      getIdempotency: function (id) { return idemp[id] || null; },
      putIdempotency: function (id, rec) { idemp[id] = rec; },
      appendAudit: function (rec) { audit.push(rec); },
    };
  }

  var api = {
    OPS: OPS,
    BOT_SOURCES: BOT_SOURCES,
    DEFAULT_RATE_LIMIT: DEFAULT_RATE_LIMIT,
    isAdminSource: isAdminSource,
    httpError: httpError,
    httpOk: httpOk,
    lookupToken: lookupToken,
    extractToken: extractToken,
    validateRequest: validateRequest,
    authorize: authorize,
    idempotencyId: idempotencyId,
    requestFingerprint: requestFingerprint,
    checkRateLimit: checkRateLimit,
    mintTaskId: mintTaskId,
    buildAddTask: buildAddTask,
    applyUpdateFields: applyUpdateFields,
    expandDriveQueueFile: expandDriveQueueFile,
    createHandler: createHandler,
    createMemoryDeps: createMemoryDeps,
    durationOf: durationOf,
    isValidDuration: isValidDuration,
    isIsoDateOrEmpty: isIsoDateOrEmpty,
  };

  root.TMBridge = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
