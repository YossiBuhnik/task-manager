// Tiny no-dependency tests for PR0 urgency / duration helpers.
// Run: node tests/urgency.test.js
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const src = fs.readFileSync(path.join(__dirname, "..", "data.js"), "utf8");
const sandbox = { window: {}, console };
vm.runInNewContext(src, sandbox, { filename: "data.js" });
const TM = sandbox.window.TM;
if (!TM) throw new Error("TM was not exported");

const TODAY = "2026-11-23";
let failed = 0;
let passed = 0;

function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

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

function is(name, cond) {
  eq(name, !!cond, true);
}

function task(fields) {
  return Object.assign(
    { id: "t_test", title: "x", status: "todo", priority: "mid", due: "", createdAt: TODAY },
    fields
  );
}

console.log("buckets (urgencyOf, today=" + TODAY + ")");
const cases = [
  ["overdue", addDays(TODAY, -1), "overdue", -1],
  ["today", TODAY, "today", 0],
  ["soon 1d", addDays(TODAY, 1), "soon", 1],
  ["soon 2d", addDays(TODAY, 2), "soon", 2],
  ["soon 3d", addDays(TODAY, 3), "soon", 3],
  ["later 4d", addDays(TODAY, 4), "later", 4],
  ["later 30d", addDays(TODAY, 30), "later", 30],
];
for (const [name, due, bucket, days] of cases) {
  const u = TM.urgencyOf(task({ due }), TODAY);
  eq(name + " bucket", u.bucket, bucket);
  eq(name + " daysUntil", u.daysUntil, days);
}
eq("no due → none", TM.urgencyOf(task({ due: "" }), TODAY).bucket, "none");
eq("no due daysUntil", TM.urgencyOf(task({ due: "" }), TODAY).daysUntil, null);
eq("missing due → none", TM.urgencyOf(task({ due: undefined }), TODAY).bucket, "none");
eq("invalid due → none", TM.urgencyOf(task({ due: "not-a-date" }), TODAY).bucket, "none");

console.log("todoScore formula is unchanged (pinned today, mid, no age)");
const dueYesterday = addDays(TODAY, -1);
const uOverdue = TM.urgencyOf(task({ due: dueYesterday, priority: "mid", createdAt: TODAY }), TODAY);
eq("overdue mid score = 1", uOverdue.score, 1);
const uHigh = TM.urgencyOf(task({ due: TODAY, priority: "high", createdAt: TODAY }), TODAY);
eq("today high score = 7", uHigh.score, 7);
const uLow = TM.urgencyOf(task({ due: TODAY, priority: "low", createdAt: TODAY }), TODAY);
eq("today low score = -7", uLow.score, -7);

console.log("listTopUrgent excludes no-due, done, and inbox (approved only); sorts by score");
const tasks = [
  task({ id: "t_nodue", title: "no due high", priority: "high", due: "" }),
  task({ id: "t_later", title: "later mid", priority: "mid", due: addDays(TODAY, 10) }),
  task({ id: "t_over", title: "overdue mid", priority: "mid", due: addDays(TODAY, -2) }),
  task({ id: "t_today", title: "today mid", priority: "mid", due: TODAY }),
  task({ id: "t_done", title: "done overdue", status: "done", priority: "high", due: addDays(TODAY, -5) }),
  task({ id: "t_inbox", title: "inbox overdue", priority: "high", due: addDays(TODAY, -3), awaitingReview: true }),
];
const top = TM.listTopUrgent(tasks, { limit: 3, today: TODAY });
eq("top ids", top.map((t) => t.id), ["t_over", "t_today", "t_later"]);
eq("no-due excluded", top.some((t) => t.id === "t_nodue"), false);
eq("done excluded", top.some((t) => t.id === "t_done"), false);
eq("inbox excluded", top.some((t) => t.id === "t_inbox"), false);
eq("limit 2", TM.listTopUrgent(tasks, { limit: 2, today: TODAY }).map((t) => t.id), ["t_over", "t_today"]);

const withInbox = TM.listByUrgency(tasks, { includeAwaitingReview: true, today: TODAY });
eq("includeAwaitingReview puts inbox first (high + overdue)", withInbox[0].id, "t_inbox");

console.log("duration bounds and format");
is("1–1 valid", TM.isValidDuration(1, 1));
is("1–720 valid", TM.isValidDuration(1, 720));
is("1–14400 valid", TM.isValidDuration(1, 14400));
is("60–90 valid", TM.isValidDuration(60, 90));
is("0–10 invalid", !TM.isValidDuration(0, 10));
is("1–14401 invalid", !TM.isValidDuration(1, 14401));
is("10–9 invalid", !TM.isValidDuration(10, 9));
is("1.5–2 invalid", !TM.isValidDuration(1.5, 2));
is("null invalid", !TM.isValidDuration(null, 10));
eq("equal → one number", TM.formatDuration(10, 10), "10 דק׳");
eq("range uses en-dash", TM.formatDuration(10, 30), "10–30 דק׳");
eq("minutes under an hour", TM.formatDuration(5, 10), "5–10 דק׳");
eq("equal minutes", TM.formatDuration(30, 30), "30 דק׳");
eq("hours on the half hour", TM.formatDuration(240, 360), "4–6 שע׳");
eq("hours one decimal", TM.formatDuration(90, 120), "1.5–2 שע׳");
eq("one hour", TM.formatDuration(60, 60), "1 שע׳");
eq("not on the half hour stays minutes", TM.formatDuration(45, 75), "45–75 דק׳");
eq("auto days", TM.formatDuration(480, 960), "1–2 ימים");
eq("one day auto", TM.formatDuration(480, 480), "1 יום");
eq("explicit minutes", TM.formatDuration(240, 360, "min"), "240–360 דק׳");
eq("explicit hours", TM.formatDuration(240, 360, "hour"), "4–6 שע׳");
eq("explicit days", TM.formatDuration(960, 1440, "day"), "2–3 ימים");
eq("one day explicit", TM.formatDuration(480, 480, "day"), "1 יום");
eq("task durationUnit", TM.formatDuration({ durationMin: 960, durationMax: 1440, durationUnit: "day" }), "2–3 ימים");
eq("invalid format empty", TM.formatDuration(0, 10), "");
eq("task equal range", TM.formatDuration({ durationMin: 15, durationMax: 15 }), "15 דק׳");
eq("legacy duration field", TM.formatDuration({ duration: 60 }), "1 שע׳");
eq("toMinutes hour", TM.toMinutes(1.5, "hour"), 90);
eq("toMinutes day", TM.toMinutes(2, "day"), 960);
eq("toMinutes min", TM.toMinutes(30, "min"), 30);

console.log("constants");
eq("APP_NAME", TM.APP_NAME, "מנהל המשימות");
eq("DURATION bounds", [TM.DURATION.MIN, TM.DURATION.MAX], [1, 14400]);
eq("michal-mail label", TM.SOURCE_BY_KEY["michal-mail"].label, "מיכל · מייל");
eq("shaked label", TM.SOURCE_BY_KEY.shaked.label, "שקד · ראש מטה");
eq("shaked is a bot source", TM.BOT_SOURCES.indexOf("shaked") !== -1, true);
eq("calendar-agent label", TM.SOURCE_BY_KEY["calendar-agent"].label, "יומן · סוכן");
eq("calendar-agent is a bot source", TM.BOT_SOURCES.indexOf("calendar-agent") !== -1, true);

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
