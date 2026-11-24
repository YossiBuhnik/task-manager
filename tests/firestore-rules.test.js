// The live board listens to the whole tasks collection. Rules are not
// filters: a list rule that reads visibility/owner rejects that listen.
// Run: node tests/firestore-rules.test.js
"use strict";

const fs = require("fs");
const path = require("path");

let failed = 0;
let passed = 0;
function is(name, cond) {
  if (cond) { passed++; console.log("  ok  " + name); }
  else { failed++; console.log("  FAIL " + name); }
}

const root = path.join(__dirname, "..");
const rules = fs.readFileSync(path.join(root, "firestore.rules"), "utf8");
const cloud = fs.readFileSync(path.join(root, "cloud.jsx"), "utf8");

const tasks = rules.slice(rules.indexOf("match /tasks/{taskId}"));
is("task match exists", tasks.length > 0);
is("get still checks the document", /allow get: if isTeamMember\(\) && canReadItem\(resource\.data\);/.test(tasks));
is("list is Yossi only and does not read the document", /allow list: if isTaskAdmin\(\);/.test(tasks));
is("tasks have no combined read rule", !/allow read:/.test(tasks));

const listen = cloud.slice(cloud.indexOf('const tasksCol = fb.collection(db, col, id, "tasks");'));
const listenHead = listen.slice(0, listen.indexOf("tasksRef.current = list"));
is("listener is the whole collection", listenHead.indexOf("fb.onSnapshot(") !== -1);
is("listener has no where", listenHead.indexOf("where(") === -1);
is("listener has no orderBy", listenHead.indexOf("orderBy(") === -1);
is("team doc stays readable for rollback", /match \/teams\/\{teamId\} \{\s*allow read, write: if isTeamMember\(\);/.test(rules));

function fnBody(name) {
  const start = rules.indexOf("function " + name + "(");
  const next = rules.indexOf("\n    function ", start + 1);
  return rules.slice(start, next === -1 ? rules.length : next);
}
const isPrivate = fnBody("isPrivate");
const isOwner = fnBody("isOwner");
const unchanged = fnBody("visibilityUnchanged");
is("visibility defaults to shared", isPrivate.indexOf('data.get("visibility", "shared")') !== -1);
is("isPrivate does not read a bare field", isPrivate.indexOf("data.visibility") === -1);
is("owner defaults to null", isOwner.indexOf('data.get("owner", null)') !== -1);
is("isOwner does not read a bare field", isOwner.indexOf("data.owner") === -1);
is("unchanged visibility default", unchanged.indexOf('after.get("visibility", "shared")') !== -1 && unchanged.indexOf('before.get("visibility", "shared")') !== -1);
is("unchanged owner default", unchanged.indexOf('after.get("owner", null)') !== -1 && unchanged.indexOf('before.get("owner", null)') !== -1);
is("unchanged source default", unchanged.indexOf('after.get("source", "")') !== -1 && unchanged.indexOf('before.get("source", "")') !== -1);
is("unchanged createdBy default", unchanged.indexOf('after.get("createdBy", "")') !== -1 && unchanged.indexOf('before.get("createdBy", "")') !== -1);
is("source helpers default to empty", fnBody("isBotSource").indexOf('data.get("source", "")') !== -1 && fnBody("clientMayWriteSource").indexOf('data.get("source", "")') !== -1 && fnBody("validTask").indexOf('data.get("source", "")') !== -1);
is("validTask visibility and owner use get", fnBody("validTask").indexOf('data.get("visibility", "shared")') !== -1 && fnBody("validTask").indexOf('data.get("owner", null)') !== -1);
is("corrections still uses get", fnBody("correctionsUnchanged").indexOf('.get("corrections", [])') !== -1);

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
