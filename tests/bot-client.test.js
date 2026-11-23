// Tiny no-dependency tests for bot-client.js (and a smoke of bot_client.py).
// Run: node tests/bot-client.test.js
"use strict";

const { createBotClient } = require("../bot-client.js");
const { spawnSync } = require("child_process");
const path = require("path");

let failed = 0;
let passed = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; console.log("  ok  " + name); }
  else { failed++; console.log("  FAIL " + name + "\n       got:      " + a + "\n       expected: " + e); }
}
function is(name, cond) { eq(name, !!cond, true); }

function mockFetch(handler) {
  return function (url, init) {
    const body = JSON.parse(init.body);
    const result = handler(body, init);
    const http = result.http == null ? 200 : result.http;
    const json = result.body;
    return Promise.resolve({
      status: http,
      json: function () { return Promise.resolve(json); },
    });
  };
}

async function main() {
  console.log("bot-client.js");
  const seen = [];
  const client = createBotClient({
    url: "https://example.invalid/exec",
    token: "tok-michal",
    source: "michal-mail",
    retries: 3,
    fetchImpl: mockFetch(function (body) {
      seen.push(body);
      return { http: 200, body: { ok: true, code: "ok", taskId: "t_abc" } };
    }),
  });
  const added = await client.addTask({ title: "Hello" }, { idempotencyKey: "michal-mail:m1" });
  eq("addTask ok", added.ok, true);
  eq("posted op", seen[0].op, "addTask");
  eq("posted token", seen[0].token, "tok-michal");
  eq("uses provided key", seen[0].idempotencyKey, "michal-mail:m1");

  await client.markDone("t_abc", { idempotencyKey: "michal-mail:d1" });
  eq("markDone payload id", seen[1].payload.id, "t_abc");
  await client.setDue("t_abc", "2026-12-01", { idempotencyKey: "michal-mail:s1" });
  eq("setDue due", seen[2].payload.due, "2026-12-01");

  const auto = createBotClient({
    url: "https://example.invalid/exec",
    token: "tok-joe",
    source: "joe",
    retries: 3,
    fetchImpl: mockFetch(function (body) {
      return { http: 200, body: { ok: true, code: "ok", taskId: "t_n", key: body.idempotencyKey } };
    }),
  });
  const r = await auto.addTask({ title: "Auto" });
  is("auto key starts with source", r.key.indexOf("joe:") === 0);

  console.log("retries reuse the same key");
  const keys = [];
  let n = 0;
  const retrying = createBotClient({
    url: "https://example.invalid/exec",
    token: "tok-michal",
    source: "michal-mail",
    retries: 3,
    fetchImpl: mockFetch(function (body) {
      keys.push(body.idempotencyKey);
      n++;
      if (n < 3) return { http: 500, body: { ok: false, code: "internal" } };
      return { http: 200, body: { ok: true, code: "ok", taskId: "t_r" } };
    }),
  });
  const retried = await retrying.addTask({ title: "R" }, { idempotencyKey: "michal-mail:stable" });
  eq("retried ok", retried.taskId, "t_r");
  eq("three attempts", keys.length, 3);
  is("same key every time", keys.every((k) => k === "michal-mail:stable"));

  console.log("Drive-queue fallback hook");
  let hooked = null;
  const falling = createBotClient({
    url: "https://example.invalid/exec",
    token: "tok-michal",
    source: "michal-mail",
    retries: 2,
    fetchImpl: mockFetch(function () {
      return { http: 500, body: { ok: false, code: "internal" } };
    }),
    onQueueFallback: function (info) {
      hooked = info;
      return { ok: true, code: "queued" };
    },
  });
  const queued = await falling.addTask({ title: "Q" }, { idempotencyKey: "michal-mail:q" });
  eq("hook result used", queued.code, "queued");
  eq("hook got same key", hooked.idempotencyKey, "michal-mail:q");
  eq("hook got op", hooked.op, "addTask");

  console.log("bot_client.py smoke");
  const py = `
import json, types, bot_client
seen = []
class R:
    def __init__(self, payload, status=200):
        self._p = json.dumps(payload).encode()
        self.status = status
    def read(self): return self._p
    def __enter__(self): return self
    def __exit__(self, *a): return False
def opener(req):
    body = json.loads(req.data.decode())
    seen.append(body)
    if len(seen) < 2:
        raise __import__('urllib').error.HTTPError(req.full_url, 500, 'x', {}, R({'ok': False, 'code': 'internal'}, 500))
    return R({'ok': True, 'code': 'ok', 'taskId': 't_py'})
c = bot_client.BotClient('https://example.invalid/exec', 'tok-joe', 'joe', retries=3, opener=opener)
out = c.add_task({'title': 'P'}, idempotency_key='joe:stable')
print(json.dumps({'ok': out['ok'], 'attempts': len(seen), 'keys': [s['idempotencyKey'] for s in seen]}))
`;
  const run = spawnSync("python3", ["-c", py], {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8",
  });
  if (run.status !== 0) {
    failed++;
    console.log("  FAIL python smoke\n       " + (run.stderr || run.stdout));
  } else {
    const out = JSON.parse(run.stdout.trim());
    eq("python ok", out.ok, true);
    eq("python retried", out.attempts, 2);
    is("python same key", out.keys.every((k) => k === "joe:stable"));
  }

  console.log("");
  console.log(passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
