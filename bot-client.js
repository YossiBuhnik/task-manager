// bot-client.js — no-dependency client for the Apps Script bot-write bridge.
// Works in Node 18+ (global fetch) or with a provided fetchImpl.
// Drive-queue fallback is a hook only; this file does not talk to Drive.
(function (root) {
  "use strict";

  var OPS = ["addTask", "updateTask", "markDone", "setDue", "approveTask"];

  function randomKey() {
    var s = Date.now().toString(36) + "-";
    for (var i = 0; i < 8; i++) s += Math.floor(Math.random() * 36).toString(36);
    return s;
  }

  function createBotClient(opts) {
    if (!opts || !opts.url || !opts.token || !opts.source) {
      throw new Error("url, token, and source are required");
    }
    var fetchImpl = opts.fetchImpl || (typeof fetch !== "undefined" ? fetch.bind(typeof window !== "undefined" ? window : globalThis) : null);
    if (!fetchImpl) throw new Error("no fetch implementation");
    var retries = opts.retries == null ? 3 : opts.retries;
    var onQueueFallback = opts.onQueueFallback || null;

    function makeKey(explicit) {
      return explicit || (opts.source + ":" + randomKey());
    }

    function postOnce(body) {
      return fetchImpl(opts.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + opts.token,
        },
        body: JSON.stringify(body),
      }).then(function (res) {
        return res.json().then(function (json) {
          return { http: res.status, body: json || {} };
        }, function () {
          return { http: res.status, body: { ok: false, code: "internal" } };
        });
      });
    }

    function call(op, payload, callOpts) {
      callOpts = callOpts || {};
      var key = makeKey(callOpts.idempotencyKey);
      var body = {
        token: opts.token,
        op: op,
        source: opts.source,
        idempotencyKey: key,
        payload: payload || {},
      };
      var attempt = 0;
      function next() {
        attempt++;
        return postOnce(body).then(function (result) {
          if (result.body && result.body.ok) return result.body;
          var retryable = result.http >= 500 || result.body.code === "internal" || result.body.code === "rate_limited";
          if (retryable && attempt < retries) return next();
          if (onQueueFallback) {
            return Promise.resolve(onQueueFallback({
              op: op, source: opts.source, idempotencyKey: key, payload: payload, lastResult: result,
            })).then(function (hook) {
              if (hook) return hook;
              var err = new Error((result.body && result.body.error) || result.body.code || "request failed");
              err.result = result;
              throw err;
            });
          }
          var err = new Error((result.body && result.body.error) || result.body.code || "request failed");
          err.result = result;
          throw err;
        }, function (err) {
          if (attempt < retries) return next();
          if (onQueueFallback) {
            return Promise.resolve(onQueueFallback({
              op: op, source: opts.source, idempotencyKey: key, payload: payload, lastError: err,
            })).then(function (hook) {
              if (hook) return hook;
              throw err;
            });
          }
          throw err;
        });
      }
      return next();
    }

    return {
      addTask: function (payload, callOpts) { return call("addTask", payload, callOpts); },
      updateTask: function (payload, callOpts) { return call("updateTask", payload, callOpts); },
      markDone: function (id, callOpts) { return call("markDone", { id: id }, callOpts); },
      setDue: function (id, due, callOpts) { return call("setDue", { id: id, due: due }, callOpts); },
      approveTask: function (id, callOpts) { return call("approveTask", { id: id }, callOpts); },
      _call: call,
      OPS: OPS,
    };
  }

  root.createBotClient = createBotClient;
  if (typeof module !== "undefined" && module.exports) module.exports = { createBotClient: createBotClient };
})(typeof globalThis !== "undefined" ? globalThis : this);
