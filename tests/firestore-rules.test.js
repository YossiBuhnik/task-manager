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

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
