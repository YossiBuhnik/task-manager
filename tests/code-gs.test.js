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
      return { getProperty: function (k) { return props[k] || ""; } };
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
  },
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

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
