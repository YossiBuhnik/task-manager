// Loads bridge/Code.gs with stubbed Apps Script services.
// Run: node tests/code-gs.test.js
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

let failed = 0;
let passed = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; console.log("  ok  " + name); }
  else { failed++; console.log("  FAIL " + name + "\n       got:      " + a + "\n       expected: " + e); }
}
function is(name, cond) { eq(name, !!cond, true); }

const root = path.join(__dirname, "..");
const codeSrc = fs.readFileSync(path.join(root, "bridge", "Code.gs"), "utf8");
const fetches = [];
const props = {
  BOT_TOKENS: JSON.stringify({ "tok-m": { source: "michal-mail", name: "michal" } }),
  MIGRATION_DONE: "true",
  FIREBASE_PROJECT_ID: "demo-project",
  RATE_LIMIT: "60",
  FIREBASE_SA_JSON: JSON.stringify({
    client_email: "sa@demo-project.iam.gserviceaccount.com",
    private_key: "stub-key",
  }),
};

function firestoreDoc(id, title) {
  return {
    name: "projects/demo-project/databases/(default)/documents/teams/main/tasks/" + id,
    fields: {
      id: { stringValue: id },
      title: { stringValue: title },
      status: { stringValue: "todo" },
      due: { stringValue: "" },
      awaitingReview: { booleanValue: false },
    },
    updateTime: "2026-11-23T00:00:00Z",
  };
}

function response(code, body) {
  return {
    getResponseCode: function () { return code; },
    getContentText: function () { return JSON.stringify(body); },
  };
}

const sandbox = {
  TMBridge: require(path.join(root, "bridge", "logic.js")),
  ContentService: { MimeType: { JSON: "application/json" }, createTextOutput: function () { return { setMimeType: function () {} }; } },
  PropertiesService: {
    getScriptProperties: function () {
      return {
        getProperty: function (k) { return props[k] || ""; },
        setProperty: function (k, v) { props[k] = String(v); },
      };
    },
  },
  CacheService: {
    getScriptCache: function () {
      return { get: function () { return "{}"; }, put: function () {} };
    },
  },
  Utilities: {
    base64EncodeWebSafe: function (s) {
      const buf = Buffer.isBuffer(s) ? s : Buffer.from(String(s));
      return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    },
    computeRsaSha256Signature: function () { return Buffer.from("sig"); },
    DigestAlgorithm: { SHA_256: "SHA_256" },
    Charset: { UTF_8: "UTF_8" },
    computeDigest: function (_alg, text) {
      const s = String(text);
      const out = [];
      for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 255);
      if (!out.length) out.push(0);
      return out;
    },
  },
  Logger: { lines: [], log: function (m) { this.lines.push(String(m)); } },
  UrlFetchApp: {
    fetch: function (url, opts) {
      fetches.push({ url: String(url), method: (opts && opts.method) || "get", payload: (opts && opts.payload) || "" });
      if (String(url).indexOf("oauth2.googleapis.com/token") !== -1) {
        return response(200, { access_token: "stub-token" });
      }
      if (String(url).indexOf(":commit") !== -1) return response(200, {});
      if (String(url).indexOf("/teams/main/tasks") !== -1) {
        if (String(url).indexOf("pageToken=") === -1) {
          return response(200, { documents: [firestoreDoc("t_page1", "one")], nextPageToken: "page-2" });
        }
        return response(200, { documents: [firestoreDoc("t_page2", "two")] });
      }
      if (String(url).indexOf("/documents/teams/main?") !== -1 || /\/documents\/teams\/main$/.test(String(url).split("?")[0])) {
        return response(200, {
          fields: {
            state: { mapValue: { fields: {
              areas: { arrayValue: { values: [{ mapValue: { fields: {
                id: { stringValue: "area_office" },
                name: { stringValue: "Office" },
              } } }] } },
              cities: { arrayValue: { values: [] } },
            } } },
          },
        });
      }
      return response(404, {});
    },
  },
  console: console,
};
vm.createContext(sandbox);
vm.runInContext(codeSrc, sandbox, { filename: "Code.gs" });

console.log("Code.gs deps");
is("source wires listTasks", codeSrc.indexOf("listTasks: listTasks_") !== -1);
is("source wires getTeamState", codeSrc.indexOf("getTeamState: getTeamState_") !== -1);
is("listTasks_ is a function", typeof sandbox.listTasks_ === "function");
is("getTeamState_ is a function", typeof sandbox.getTeamState_ === "function");

const listed = sandbox.handleWithDeps_(JSON.stringify({
  token: "tok-m", op: "listTasks", source: "michal-mail", payload: { limit: 10 },
}), {});
eq("listTasks code", listed.body.code, "ok");
eq("listTasks pages both docs", listed.body.tasks.map((t) => t.id), ["t_page1", "t_page2"]);
is("list fetch is GET", fetches.some((f) => f.method === "get" && f.url.indexOf("/teams/main/tasks") !== -1));
is("second page requested", fetches.some((f) => f.url.indexOf("pageToken=page-2") !== -1));

fetches.length = 0;
const refs = sandbox.handleWithDeps_(JSON.stringify({
  token: "tok-m", op: "listRefs", source: "michal-mail", payload: {},
}), {});
eq("listRefs area", refs.body.areas, [{ id: "area_office", name: "Office" }]);
is("team doc was read", fetches.some((f) => f.method === "get" && /\/teams\/main(\?|$)/.test(f.url)));
is("state blob not written", !fetches.some((f) => f.url.indexOf(":commit") !== -1 && /\/documents\/teams\/main"/.test(String(f.payload))));

console.log("migration menu");
const SECRET = "SECRET_TITLE_XYZ";
let migrationTasks = [{ id: "t_old", title: SECRET }, { id: "t_new", title: SECRET }];
let commitStatus = 200;
sandbox.UrlFetchApp.fetch = function (url, opts) {
  fetches.push({ url: String(url), method: (opts && opts.method) || "get", payload: (opts && opts.payload) || "" });
  if (String(url).indexOf("oauth2.googleapis.com/token") !== -1) return response(200, { access_token: "stub-token" });
  if (String(url).indexOf(":commit") !== -1) return response(commitStatus, {});
  if (String(url).indexOf("/teams/main/tasks") !== -1) {
    return response(200, { documents: migrationTasks.filter((t) => t.existing).map((t) => firestoreDoc(t.id, t.title)) });
  }
  if (String(url).indexOf("/documents/teams/main?") !== -1 || /\/documents\/teams\/main$/.test(String(url).split("?")[0])) {
    return response(200, {
      fields: {
        state: { mapValue: { fields: {
          areas: { arrayValue: { values: [] } },
          cities: { arrayValue: { values: [{ mapValue: { fields: {
            id: { stringValue: "c1" },
            areaId: { stringValue: "area_office" },
            projects: { arrayValue: { values: [{ mapValue: { fields: {
              id: { stringValue: "p1" },
              tasks: { arrayValue: { values: migrationTasks.map((t) => ({ mapValue: { fields: {
                id: { stringValue: t.id },
                title: { stringValue: t.title },
                notes: { stringValue: "SECRET_NOTE_XYZ" },
                status: { stringValue: "todo" },
                duration: { integerValue: "60" },
              } } })) } },
            } } }] } },
          } } }] } },
        } } },
      },
    });
  }
  return response(404, {});
};

function logText() { return sandbox.Logger.lines.join("\n"); }
function commitWrites() {
  return fetches.filter((f) => f.url.indexOf(":commit") !== -1).map((f) => JSON.parse(f.payload).writes || []);
}

fetches.length = 0;
sandbox.Logger.lines.length = 0;
sandbox.migrationDryRun();
const dry = JSON.parse(props.MIGRATION_DRYRUN);
eq("dry-run documents", dry.counts.documents, 2);
is("dry-run stored hash", typeof dry.hash === "string" && dry.hash.length > 0);
is("dry-run writes nothing", commitWrites().length === 0);
is("dry-run log has no title", logText().indexOf(SECRET) === -1 && logText().indexOf("SECRET_NOTE_XYZ") === -1);

fetches.length = 0;
sandbox.Logger.lines.length = 0;
props.MIGRATION_DONE = "true";
sandbox.migrationRun();
is("done refuses", logText().indexOf("migration_done") !== -1);
is("done writes nothing", commitWrites().length === 0);

fetches.length = 0;
sandbox.Logger.lines.length = 0;
props.MIGRATION_DONE = "";
delete props.MIGRATION_DRYRUN;
sandbox.migrationRun();
is("missing dry run refuses", logText().indexOf("missing_dry_run") !== -1);
is("missing dry run writes nothing", commitWrites().length === 0);

fetches.length = 0;
sandbox.Logger.lines.length = 0;
props.MIGRATION_DRYRUN = JSON.stringify({ hash: "00", counts: {} });
sandbox.migrationRun();
is("hash mismatch refuses", logText().indexOf("hash_mismatch") !== -1);
is("hash mismatch writes nothing", commitWrites().length === 0);

fetches.length = 0;
sandbox.Logger.lines.length = 0;
sandbox.migrationDryRun();
migrationTasks[0].existing = true;
commitStatus = 200;
fetches.length = 0;
sandbox.Logger.lines.length = 0;
sandbox.migrationRun();
const result = JSON.parse(props.MIGRATION_RESULT);
eq("create-only counts", [result.written, result.skipped, result.failed], [1, 1, 0]);
is("MIGRATION_DONE stays unset", props.MIGRATION_DONE !== "true");
const writes = commitWrites();
is("one create batch", writes.length === 1 && writes[0].length === 1);
is("create-only exists false", writes[0][0].currentDocument && writes[0][0].currentDocument.exists === false);
is("write is a task doc", writes[0][0].update.name.indexOf("/teams/main/tasks/t_new") !== -1);
is("state blob not in migration writes", !writes.some((batch) => batch.some((w) => /\/documents\/teams\/main$/.test(w.update.name))));
is("run log has no title", logText().indexOf(SECRET) === -1);

fetches.length = 0;
sandbox.Logger.lines.length = 0;
delete props.MIGRATION_RESULT;
migrationTasks = [{ id: "t_conflict", title: SECRET }];
sandbox.migrationDryRun();
commitStatus = 409;
fetches.length = 0;
sandbox.Logger.lines.length = 0;
sandbox.migrationRun();
const conflicted = JSON.parse(props.MIGRATION_RESULT);
eq("conflict counts as skipped", [conflicted.written, conflicted.skipped, conflicted.failed], [0, 1, 0]);
is("conflict log has no title", logText().indexOf(SECRET) === -1);

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
