// bridge/logic.js — pure bot-write logic (no Apps Script, no secrets).
// Used by tests in Node and by Code.gs (copied into the Apps Script project
// as Logic.gs so TMBridge is a global).
(function (root) {
  "use strict";

  var OPS = ["addTask", "updateTask", "markDone", "setDue", "approveTask"];
  var BOT_SOURCES = ["michal-mail", "ron-site", "noga-tour", "joe", "ido"];
  var STATUSES = ["todo", "doing", "done"];
  var PRIORITIES = ["high", "mid", "low"];
  var PROTECTED = { source: 1, createdBy: 1, owner: 1, visibility: 1 };
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

  function isValidDuration(min, max) {
    return Number.isInteger(min) && Number.isInteger(max) && min >= 1 && max <= 720 && min <= max;
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
    if (!key || typeof key !== "string" || !key.trim() || key.length > IDEMPOTENCY_MAX_LEN) {
      return { error: httpError(400, "invalid", "idempotencyKey") };
    }
    var source = body.source != null && body.source !== "" ? body.source : actor.source;
    if (BOT_SOURCES.indexOf(source) === -1) return { error: httpError(400, "invalid", "source") };
    if (!isAdminSource(actor.source) && source !== actor.source) {
      return { error: httpError(403, "forbidden", "source mismatch") };
    }
    var payload = body.payload || {};
    if (typeof payload !== "object") return { error: httpError(400, "invalid", "payload") };
    for (var k in payload) {
      if (PROTECTED[k] && payload[k] !== undefined) {
        return { error: httpError(400, "invalid", "protected field") };
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
    if (body.op === "updateTask" || body.op === "markDone" || body.op === "setDue" || body.op === "approveTask") {
      if (!payload.id || typeof payload.id !== "string") return { error: httpError(400, "invalid", "id") };
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

  function authorize(actor, op, existing) {
    if (op === "addTask") return { ok: true };
    if (!existing) return { error: httpError(404, "not_found") };
    if (isAdminSource(actor.source)) return { ok: true };
    if (op === "markDone" || op === "approveTask") {
      return { error: httpError(403, "forbidden", "admin only") };
    }
    if (existing.source !== actor.source) {
      return { error: httpError(403, "forbidden", "other bot's task") };
    }
    if (!existing.awaitingReview) {
      return { error: httpError(403, "forbidden", "already approved") };
    }
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
    return {
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

      var idempId = idempotencyId(checked.source, checked.idempotencyKey);
      var fp = requestFingerprint(checked.op, checked.source, checked.payload);
      var prev = deps.getIdempotency && deps.getIdempotency(idempId);
      if (prev) {
        if (prev.fingerprint !== fp) return httpError(409, "conflict", "idempotency key reused");
        return { http: 200, body: prev.response };
      }

      var existing = null;
      var existingMeta = null;
      if (checked.op !== "addTask") {
        existingMeta = deps.getTask ? deps.getTask(checked.payload.id) : null;
        existing = existingMeta && existingMeta.doc;
        if (!existing) return httpError(404, "not_found");
      }

      var authz = authorize(actor, checked.op, existing);
      if (authz.error) return authz.error;

      var taskId, doc, type, result;
      try {
        if (checked.op === "addTask") {
          taskId = (checked.payload.id && /^t_/.test(checked.payload.id)) ? checked.payload.id : (deps.mintId || mintTaskId)();
          if (deps.getTask && deps.getTask(taskId)) return httpError(409, "conflict", "id exists");
          doc = buildAddTask(checked.payload, checked.source, actor, taskId);
          if (doc.createdAt == null) doc.createdAt = new Date(now).toISOString().slice(0, 10);
          deps.commitTask({ type: "create", id: taskId, doc: doc });
        } else {
          taskId = existing.id;
          if (checked.op === "markDone") doc = applyUpdateFields(existing, { status: "done" });
          else if (checked.op === "setDue") doc = applyUpdateFields(existing, { due: checked.payload.due || "" });
          else if (checked.op === "approveTask") {
            doc = applyUpdateFields(existing, {});
            doc.awaitingReview = false;
            doc.version = (existing.version || 1) + 1;
          } else doc = applyUpdateFields(existing, checked.payload);
          deps.commitTask({
            type: "update",
            id: taskId,
            doc: doc,
            updateTime: existingMeta && existingMeta.updateTime,
          });
        }
      } catch (err) {
        var code = err && err.code;
        if (code === "conflict") return httpError(409, "conflict", "version");
        if (code === "not_found") return httpError(404, "not_found");
        return httpError(500, "internal");
      }

      result = httpOk(taskId);
      if (deps.putIdempotency) {
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
