"""No-dependency Python client for the Apps Script bot-write bridge.

Drive-queue fallback is a hook only; this module does not talk to Drive
and does not read FIREBASE_TASKS_SA_JSON or any other secret file.
"""
from __future__ import annotations

import json
import time
import uuid
import urllib.error
import urllib.request
from typing import Any, Callable, Optional


class BotClientError(Exception):
    def __init__(self, message: str, result: Optional[dict] = None):
        super().__init__(message)
        self.result = result or {}


class BotClient:
    def __init__(
        self,
        url: str,
        token: str,
        source: str,
        *,
        retries: int = 3,
        on_queue_fallback: Optional[Callable[[dict], Any]] = None,
        opener: Optional[Callable] = None,
    ):
        if not url or not token or not source:
            raise ValueError("url, token, and source are required")
        self.url = url
        self.token = token
        self.source = source
        self.retries = retries
        self.on_queue_fallback = on_queue_fallback
        self._opener = opener or urllib.request.urlopen

    def _key(self, explicit: Optional[str]) -> str:
        return explicit or f"{self.source}:{uuid.uuid4()}"

    def _post(self, body: dict) -> dict:
        data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            self.url,
            data=data,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.token}",
            },
        )
        try:
            with self._opener(req) as resp:
                raw = resp.read().decode("utf-8")
                http = getattr(resp, "status", 200)
                payload = json.loads(raw) if raw else {}
                return {"http": http, "body": payload}
        except urllib.error.HTTPError as e:
            raw = e.read().decode("utf-8") if e.fp else ""
            try:
                payload = json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                payload = {"ok": False, "code": "internal"}
            return {"http": e.code, "body": payload}

    def call(self, op: str, payload: Optional[dict] = None, *, idempotency_key: Optional[str] = None) -> dict:
        key = self._key(idempotency_key)
        body = {
            "token": self.token,
            "op": op,
            "source": self.source,
            "idempotencyKey": key,
            "payload": payload or {},
        }
        last_err: Optional[BaseException] = None
        last_result: Optional[dict] = None
        for attempt in range(self.retries):
            try:
                result = self._post(body)
            except Exception as e:  # network
                last_err = e
                if attempt + 1 < self.retries:
                    time.sleep(0.05 * (attempt + 1))
                    continue
                break
            last_result = result
            if result.get("body", {}).get("ok"):
                return result["body"]
            code = result.get("body", {}).get("code")
            retryable = result.get("http", 0) >= 500 or code in ("internal", "rate_limited")
            if retryable and attempt + 1 < self.retries:
                time.sleep(0.05 * (attempt + 1))
                continue
            break
        hook_payload = {
            "op": op,
            "source": self.source,
            "idempotencyKey": key,
            "payload": payload,
            "lastResult": last_result,
            "lastError": last_err,
        }
        if self.on_queue_fallback:
            hooked = self.on_queue_fallback(hook_payload)
            if hooked:
                return hooked
        if last_result is not None:
            body = last_result.get("body") or {}
            raise BotClientError(body.get("error") or body.get("code") or "request failed", last_result)
        raise last_err or BotClientError("request failed")

    def add_task(self, payload: dict, *, idempotency_key: Optional[str] = None) -> dict:
        return self.call("addTask", payload, idempotency_key=idempotency_key)

    def update_task(self, payload: dict, *, idempotency_key: Optional[str] = None) -> dict:
        return self.call("updateTask", payload, idempotency_key=idempotency_key)

    def mark_done(self, task_id: str, *, idempotency_key: Optional[str] = None) -> dict:
        return self.call("markDone", {"id": task_id}, idempotency_key=idempotency_key)

    def set_due(self, task_id: str, due: str, *, idempotency_key: Optional[str] = None) -> dict:
        return self.call("setDue", {"id": task_id, "due": due}, idempotency_key=idempotency_key)

    def approve_task(self, task_id: str, *, idempotency_key: Optional[str] = None) -> dict:
        return self.call("approveTask", {"id": task_id}, idempotency_key=idempotency_key)
