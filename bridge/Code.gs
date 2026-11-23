// Code.gs — Apps Script Web App wrapper for the bot-write bridge.
// Do not deploy until Yossi approves. This file does not contain secrets.
//
// Also add logic.js to the Apps Script project as Logic.gs (same TMBridge global).
//
// Deployment (after approval): Execute as: me (yossib@tskeng-il.co.il).
// Who has access: Anyone. Protection is the per-bot token + rate limit.
//
// Script Properties (placeholder names only — never commit real values):
//   BOT_TOKENS          JSON { "<token>": { "source": "<source>", "name": "<bot>" } }
//   FIREBASE_SA_JSON    service-account JSON (never log)
//   FIREBASE_PROJECT_ID e.g. the Firebase project id
//   RATE_LIMIT          optional integer, default 60 / minute
//   MIGRATION_DONE      "true" only after an approved migration and Yossi has approved.
//                       Until then doPost refuses with 403 migration_pending
//                       (the safe option: no legacy blob writes from this bridge).
//   DRIVE_QUEUE_FOLDER_ID  optional; used by drainDriveQueue (5-minute trigger)
//
// Firestore writes go only to teams/main/tasks/{id}, plus
// teams/main/idempotency/{id} and teams/main/audit/{id}.
// The legacy teams/main.state blob is never written by this script.

function doPost(e) {
  var raw = (e && e.postData && e.postData.contents) || "{}";
  var result = handleWithDeps_(raw, {});
  // Apps Script web apps typically return HTTP 200; the contract status lives
  // in the JSON body (`ok`, `code`). [לאימות] if a wrapper can surface http.
  return ContentService
    .createTextOutput(JSON.stringify(result.body))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: false, code: "invalid", error: "use POST" }))
    .setMimeType(ContentService.MimeType.JSON);
}

// Optional 5-minute time trigger. Compatibility only: not the source of truth.
// Expects Drive files whose JSON has addTasks / markDone / setDue + source
// (same shape as today's tasks_app.py apply file).
function drainDriveQueue() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty("MIGRATION_DONE") !== "true") return;
  var folderId = props.getProperty("DRIVE_QUEUE_FOLDER_ID");
  if (!folderId) return;
  var folder = DriveApp.getFolderById(folderId);
  var files = folder.getFiles();
  var tokens = JSON.parse(props.getProperty("BOT_TOKENS") || "{}");
  // A reserved queue token is looked up by source; the file's source must
  // map to a bot. We do not read tokens from the file.
  var tokenBySource = {};
  var t;
  for (t in tokens) {
    if (Object.prototype.hasOwnProperty.call(tokens, t) && tokens[t].source) {
      tokenBySource[tokens[t].source] = t;
    }
  }
  while (files.hasNext()) {
    var file = files.next();
    var name = file.getName() || "";
    if (name.charAt(0) === ".") continue;
    var parsed;
    try { parsed = JSON.parse(file.getBlob().getDataAsString()); }
    catch (err) { continue; }
    var ops = TMBridge.expandDriveQueueFile(file.getId(), parsed);
    var token = tokenBySource[parsed.source];
    var i, res, allOk = true;
    for (i = 0; i < ops.length; i++) {
      ops[i].token = token;
      res = handleWithDeps_(JSON.stringify(ops[i]), {});
      if (!res || !res.body || !res.body.ok) allOk = false;
    }
    if (allOk) file.setName("." + name + ".done");
  }
}

function handleWithDeps_(raw, headers) {
  var props = PropertiesService.getScriptProperties();
  var tokenMap = {};
  try { tokenMap = JSON.parse(props.getProperty("BOT_TOKENS") || "{}"); }
  catch (e) { tokenMap = {}; }
  var rateLimit = Number(props.getProperty("RATE_LIMIT") || "");
  var buckets = loadRateBuckets_();
  var deps = {
    nowMs: function () { return Date.now(); },
    tokenMap: tokenMap,
    rateBuckets: buckets,
    rateLimit: isFinite(rateLimit) && rateLimit > 0 ? rateLimit : TMBridge.DEFAULT_RATE_LIMIT,
    migrationDone: props.getProperty("MIGRATION_DONE") === "true",
    mintId: function () { return TMBridge.mintTaskId(); },
    getTask: getTask_,
    commitTask: commitTask_,
    getIdempotency: getIdempotency_,
    putIdempotency: putIdempotency_,
    appendAudit: appendAudit_,
  };
  var result = TMBridge.createHandler(deps)(raw, headers);
  flushRateBuckets_(buckets);
  return result;
}

function loadRateBuckets_() {
  var raw = CacheService.getScriptCache().get("rate_buckets") || "{}";
  try { return JSON.parse(raw); } catch (e) { return {}; }
}

function flushRateBuckets_(buckets) {
  try { CacheService.getScriptCache().put("rate_buckets", JSON.stringify(buckets), 120); } catch (e) {}
}

function projectId_() {
  return PropertiesService.getScriptProperties().getProperty("FIREBASE_PROJECT_ID") || "";
}

function docName_(rel) {
  return "projects/" + projectId_() + "/databases/(default)/documents/" + rel;
}

function getAccessToken_() {
  var raw = PropertiesService.getScriptProperties().getProperty("FIREBASE_SA_JSON");
  if (!raw) throw new Error("missing FIREBASE_SA_JSON");
  var sa = JSON.parse(raw);
  var now = Math.floor(Date.now() / 1000);
  var header = Utilities.base64EncodeWebSafe(JSON.stringify({ alg: "RS256", typ: "JWT" })).replace(/=+$/, "");
  var claim = Utilities.base64EncodeWebSafe(JSON.stringify({
    iss: sa.client_email,
    sub: sa.client_email,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
    scope: "https://www.googleapis.com/auth/datastore",
  })).replace(/=+$/, "");
  var toSign = header + "." + claim;
  var sig = Utilities.base64EncodeWebSafe(Utilities.computeRsaSha256Signature(toSign, sa.private_key)).replace(/=+$/, "");
  var jwt = toSign + "." + sig;
  var resp = UrlFetchApp.fetch("https://oauth2.googleapis.com/token", {
    method: "post",
    payload: {
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    },
    muteHttpExceptions: true,
  });
  var body = JSON.parse(resp.getContentText() || "{}");
  if (!body.access_token) throw new Error("token exchange failed");
  return body.access_token;
}

function firestoreGet_(rel) {
  var url = "https://firestore.googleapis.com/v1/" + docName_(rel);
  var resp = UrlFetchApp.fetch(url, {
    method: "get",
    headers: { Authorization: "Bearer " + getAccessToken_() },
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() === 404) return null;
  if (resp.getResponseCode() >= 400) throw new Error("firestore get " + resp.getResponseCode());
  return JSON.parse(resp.getContentText());
}

function fromFirestoreValue_(v) {
  if (v == null) return null;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.nullValue !== undefined) return null;
  if (v.mapValue && v.mapValue.fields) {
    var o = {}, k;
    for (k in v.mapValue.fields) o[k] = fromFirestoreValue_(v.mapValue.fields[k]);
    return o;
  }
  if (v.arrayValue && v.arrayValue.values) {
    return v.arrayValue.values.map(fromFirestoreValue_);
  }
  return null;
}

function fromFirestoreDoc_(doc) {
  if (!doc || !doc.fields) return null;
  var out = {}, k;
  for (k in doc.fields) out[k] = fromFirestoreValue_(doc.fields[k]);
  return out;
}

function toFirestoreValue_(v) {
  if (v === null || v === undefined) return { nullValue: "NULL_VALUE" };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFirestoreValue_) } };
  if (typeof v === "object") {
    var fields = {}, k;
    for (k in v) {
      if (Object.prototype.hasOwnProperty.call(v, k) && v[k] !== undefined) {
        fields[k] = toFirestoreValue_(v[k]);
      }
    }
    return { mapValue: { fields: fields } };
  }
  return { stringValue: String(v) };
}

function toFirestoreFields_(obj) {
  var fields = {}, k;
  for (k in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, k) && obj[k] !== undefined) {
      fields[k] = toFirestoreValue_(obj[k]);
    }
  }
  return fields;
}

function firestoreCommit_(writes) {
  var url = "https://firestore.googleapis.com/v1/projects/" + projectId_() +
    "/databases/(default)/documents:commit";
  var resp = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + getAccessToken_() },
    payload: JSON.stringify({ writes: writes }),
    muteHttpExceptions: true,
  });
  var code = resp.getResponseCode();
  if (code === 409) { var e = new Error("conflict"); e.code = "conflict"; throw e; }
  if (code === 404) { var e2 = new Error("not_found"); e2.code = "not_found"; throw e2; }
  if (code >= 400) throw new Error("firestore commit " + code);
  return JSON.parse(resp.getContentText() || "{}");
}

function getTask_(id) {
  var doc = firestoreGet_("teams/main/tasks/" + id);
  if (!doc) return null;
  return { doc: fromFirestoreDoc_(doc), updateTime: doc.updateTime };
}

function commitTask_(w) {
  var name = docName_("teams/main/tasks/" + w.id);
  var write = {
    update: { name: name, fields: toFirestoreFields_(w.doc) },
  };
  if (w.type === "create") write.currentDocument = { exists: false };
  else if (w.updateTime) write.currentDocument = { updateTime: w.updateTime };
  else write.currentDocument = { exists: true };
  firestoreCommit_([write]);
}

function getIdempotency_(id) {
  var doc = firestoreGet_("teams/main/idempotency/" + id);
  return doc ? fromFirestoreDoc_(doc) : null;
}

function putIdempotency_(id, rec) {
  var safe = {
    source: rec.source,
    idempotencyKey: rec.idempotencyKey,
    op: rec.op,
    taskId: rec.taskId,
    status: rec.status,
    fingerprint: rec.fingerprint,
    // Store the public response only (ok/code/taskId). Never tokens or titles.
    response: rec.response,
    createdAt: rec.createdAt,
  };
  firestoreCommit_([{
    update: { name: docName_("teams/main/idempotency/" + id), fields: toFirestoreFields_(safe) },
  }]);
}

function appendAudit_(rec) {
  // Do not log titles, notes, emails, tokens, or the service-account JSON.
  var id = "a_" + rec.at + "_" + TMBridge.idempotencyId(rec.source, rec.idempotencyKey);
  firestoreCommit_([{
    update: {
      name: docName_("teams/main/audit/" + id),
      fields: toFirestoreFields_({
        at: rec.at,
        source: rec.source,
        op: rec.op,
        taskId: rec.taskId,
        idempotencyKey: rec.idempotencyKey,
        result: rec.result,
      }),
    },
  }]);
}
