# Bot write endpoint — PR2 specification

This is the detailed write-point spec for **PR2** (`ido/bot-writes`). It does not change running systems. It follows Yossi's decisions of 23/11/2026 and `TASK-BOARD-CONTRACT.md`.

Decision (contract §7): **one Apps Script bridge is the write point for all bots**, including `tasks_app.py`. No direct bot writes to Firestore, even with a service account. Extend that bridge with a **separate token per bot**. Do **not** add Cloud Functions and do **not** switch the Firebase project to Blaze. The legacy Apps Script is «גשר משימות»: its triggers were deleted for the freeze, and only `exportTasks` is restored afterwards.

Secrets (tokens, service-account JSON) live only in Apps Script **Script Properties**. They are never committed. The property that existing tools call `FIREBASE_TASKS_SA_JSON` must not be read or printed from Joe's box; PR2 copies the same kind of credential into Script Properties through a manual, approved setup step.

## 1. Endpoint

- One Google Apps Script web app, deployed as a web app (`doPost`).
- HTTPS POST, JSON body, `Content-Type: application/json`.
- The shared bridge project / deployment ID is not in the public repo [לאימות]. It is distinct from the legacy script «גשר משימות» (see §11). That script is not a second write path.
- The script writes with a **service account** stored in Script Properties, via the Firestore REST API, to `teams/main/tasks/{id}` (one document per task). It does **not** rewrite the legacy `teams/main` `state` blob. This is the only permitted service-account writer. Client (Yossi) writes go through the app under Firestore rules (PR1), not through this endpoint.
- **Ordering guarantee:** the bridge serializes writes **per task** with a transaction plus an `updatedAt` / version precondition and `idempotencyKey`. Concurrent or retried writes to the same id keep a defined order, do not clobber, and do not duplicate.

## 2. Per-bot tokens

Script Properties (names are indicative):

| Property | Purpose |
|---|---|
| `BOT_TOKENS` | JSON map `{ "<token>": { "source": "<source>", "name": "<bot>" } }`. One token per bot. Tokens are random, high-entropy, and rotatable. |
| `FIREBASE_SA_JSON` | Service-account JSON for Firestore writes. Never logged. |
| `RATE_LIMIT` | Optional override of the default limit. |

The request sends the token in the JSON body field `token` (and may also send `Authorization: Bearer <token>`). The token is looked up in `BOT_TOKENS`; it is not accepted from query parameters (avoids log leakage).

A token is bound to exactly one `source`. For non-Joe tokens, the request `source`, if present, must match the token's source. The **Joe token** may act on a task of any source (approve / markDone / edit).

`shaked` (שקד · ראש מטה) is a bot source, not an admin. Shaked gets its own entry in the `BOT_TOKENS` Script Property. No token value is stored in the repo. Shaked writes only when Yossi asks. Tasks it creates are stored with `awaitingReview: true`.

## 3. Request schema

```json
{
  "token": "<per-bot secret>",
  "op": "addTask" | "updateTask" | "markDone" | "setDue" | "approveTask" | "proposeDone" | "acceptProposal" | "rejectProposal" | "listTasks" | "listRefs",
  "idempotencyKey": "<required string>",
  "source": "michal-mail" | "ron-site" | "noga-tour" | "joe" | "ido" | "shaked",
  "payload": {}
}
```

`idempotencyKey` is **required** on every write (including retries). Recommended form: `<source>:<stable-id>` (for example a mail message id, a Drive file id + row, or a calendar event id). It is optional on the reads `listTasks` and `listRefs`.

Every op that names a task accepts `payload.taskId` or `payload.id` (`updateTask`, `setDue`, `markDone`, `approveTask`, `proposeDone`, `acceptProposal`, `rejectProposal`).

### Payload by `op`

- `addTask`: `{ title, due?, durationMin?, durationMax?, durationUnit?, priority?, projectId?, cityId?, areaId?, notes?, assignee?, time?, …contract fields }`. `title` is required. Missing duration defaults to `60`/`60`. Optional `durationUnit` is `min`, `hour`, or `day` (display only). `status` defaults to `todo`. `awaitingReview` is forced to `true`. A new `t_…` id is minted unless a contract-valid id is supplied and free.
- `updateTask`: `{ id, …partial fields }`. `id` is required. Cannot change `id`, `source`, `createdBy`, `owner`, or `visibility`. Cannot set `status` to `done` (use `markDone`).
- `markDone`: `{ id }` plus the request `idempotencyKey`. Sets `status` to `done`. Only the `joe` token or a `yossi` token. Joe may mark done another bot's task.
- `setDue`: `{ id, due }` plus the request `idempotencyKey`. Sets `due` to `YYYY-MM-DD` or `""`.
- `approveTask`: `{ id }`. Sets `awaitingReview` to `false`. **Joe token only** (Yossi approves in the app under rules). Other bot tokens cannot approve.

Joe's end-of-day close uses these field updates, one call per task, addressed by `id` and `idempotencyKey`: `markDone` (`status: done`) and `setDue` (`due`). A replay of either op with the same `idempotencyKey` and the same payload returns the stored `200` and does not write again.

A bot that does not own the task (`createdBy` / `source` is not the caller's source) or that calls `updateTask` / `setDue` after `awaitingReview` is false does **not** change the task. The bridge stores `proposals[]` entry `{ kind: "edit", fields, by, at, idempotencyKey, state: "pending" }` and responds `code: "proposed"`. The bot's own task while `awaitingReview` is still true is applied as before. `joe` / `yossi` apply directly.

### Proposals and `listTasks` (for `tasks_app.py`)

`proposeDone` never sets `status`. Any bot token may call it. Only `joe` / `yossi` may `acceptProposal` (kind `done` becomes `markDone`) or `rejectProposal`.

Request:

```json
{ "token": "<bot>", "op": "proposeDone", "source": "ron-site", "idempotencyKey": "ron-site:t_1:done", "payload": { "taskId": "t_1", "note": "finished on site" } }
```

Response (`status` unchanged, one pending proposal):

```json
{ "ok": true, "code": "proposed", "taskId": "t_1", "proposalId": "prop_…" }
```

Accept (Joe):

```json
{ "token": "<joe>", "op": "acceptProposal", "source": "joe", "idempotencyKey": "joe:t_1:accept", "payload": { "taskId": "t_1", "proposalId": "prop_…" } }
```

Response: `{ "ok": true, "code": "ok", "taskId": "t_1" }` and `status` is `done`.

`listTasks` is a read. Any valid token. Same `403 migration_pending` until `MIGRATION_DONE` is `"true"`. `idempotencyKey` is optional. Filters: `since`, `status`, `area`, `awaitingReview` (boolean), `source`, `dueFrom` / `dueTo` (ISO `YYYY-MM-DD`, inclusive; a task with an empty `due` is excluded when either bound is set), `limit` (default 50, max 100), `cursor`.

A non-admin token does not receive tasks with `visibility: "private"`, or tasks whose area, city, or project is private on the team state. `joe` / `yossi` receive them. `area` and `project` on each row are deprecated aliases of `areaId` and `projectId`. Prefer `areaId`, `projectId`, and `cityId`. `proposals` remains the count of pending proposals. `proposalsPending` is the same count. `proposalList` is `[{ id, kind, by, at, state }]` for every proposal (pending, accepted, or rejected) and does not include field values or notes.

```json
{ "token": "<bot>", "op": "listTasks", "source": "joe", "payload": { "status": "todo", "area": "area_office", "awaitingReview": true, "source": "michal-mail", "dueFrom": "2026-11-01", "dueTo": "2026-11-30", "limit": 50 } }
```

```json
{ "ok": true, "code": "ok", "nextCursor": null, "tasks": [{ "id": "t_1", "title": "…", "status": "todo", "due": "2026-11-23", "durationMin": 60, "durationMax": 90, "durationUnit": "hour", "areaId": "area_office", "cityId": "c_1", "projectId": "p_1", "area": "area_office", "project": "p_1", "awaitingReview": true, "proposals": 1, "proposalsPending": 1, "proposalList": [{ "id": "prop_…", "kind": "edit", "by": "michal-mail", "at": "2026-11-23T10:00:00.000Z", "state": "pending" }] }] }
```

### Corrections

An admin (`joe` or `yossi`) `updateTask` or `setDue` on a **bot-created** task with `awaitingReview: true` must include `correctionReason: { kind, reason }`. Otherwise the body `code` is `invalid` and `error` is `correctionReason required`. `kind` is `date | owner | wording | scope | duplicate | other`. `reason` is required free text, trimmed, at most 500 characters. The bridge appends to `corrections` (protected, clients cannot write it; cap 20, oldest dropped). Entry: `{ at, by, op, fields, before, after, reason, kind }`. After approval the reason is optional: supplied means an entry is stored; omitted means no entry and no error. The audit log does not store `reason`, `before`, or `after`.

The app must send edits of a pending bot task through this bridge, not a direct Firestore write. That direct path is unchanged in this change.

`listCorrections` is a read. Entries are for tasks whose `source` is the requested source, ordered by `at` ascending (then task id). `since` is an inclusive lower bound on `at`. Default `limit` 50, max 200. A non-admin token may request only its own source. `joe` / `yossi` may pass any source. `listTasks` rows include `corrections`.

```json
{ "token": "<joe>", "op": "updateTask", "source": "joe", "idempotencyKey": "joe:t_1:fix", "payload": { "taskId": "t_1", "title": "Better", "correctionReason": { "kind": "wording", "reason": "clearer" } } }
```

```json
{ "token": "<michal>", "op": "listCorrections", "source": "michal-mail", "payload": { "source": "michal-mail", "since": "2026-11-01T00:00:00.000Z", "limit": 50 } }
```

`listRefs` is a read of the board's areas, cities, and projects. They still live on the `teams/main` state blob (not a separate collection). The bridge reads that blob and does not write it. Any valid token. Same `403 migration_pending`. Only `id`, `name`, and parent ids are returned. `joe` / `yossi` see private items; every other source omits private areas and the cities and projects under them, and omits private projects.

```json
{ "token": "<bot>", "op": "listRefs", "source": "ron-site", "payload": {} }
```

```json
{ "ok": true, "code": "ok", "areas": [{ "id": "area_office", "name": "משרד" }], "cities": [{ "id": "c_1", "name": "עירייה", "areaId": "area_office" }], "projects": [{ "id": "p_1", "name": "צומת", "cityId": "c_1", "areaId": "area_office" }] }
```

Single-task writes are the primary path and are accepted **at any time of day**. This is required for Michal's mail-derived updates, which arrive live throughout the day (not only at end of day). Details: §7. A batch is allowed only as a compatibility wrapper (see §9): the handler splits it into per-task operations, each with its own `idempotencyKey`.

## 4. Validation

Reject with `400` before any write if:

- `op` is unknown, or `idempotencyKey` is missing / empty / longer than 200 characters.
- `source` is not a bot source, or does not match the token.
- `title` is missing or empty on `addTask`.
- `status` / `priority` / `source` are not in the contract enums.
- `due` is not `""` or `YYYY-MM-DD`.
- `durationMin` / `durationMax` fail `1 ≤ min ≤ max ≤ 14400` (integers). `durationUnit`, when present, is not `min`, `hour`, or `day`.
- `id` is missing on `updateTask` / `markDone` / `setDue` / `approveTask`, or does not exist (`404`).
- Payload contains unexpected top-level keys that would overwrite `visibility`, `owner`, `createdBy`, or `source`.

## 5. Authorization matrix (includes rule 5)

Rule 5: **only Yossi and Joe** may mark done or edit a task inserted by another bot. Confirmed: **only Yossi and Joe approve** a task out of the queue, and a **bot may edit its own task while `awaitingReview` is true**.

Joe has **no Google login**. His identity is the **`joe` bridge token** (used by `tasks_app.py` and by Joe himself). All of Joe's approve / markDone / edit powers are enforced **in this bridge**, not in Firestore rules. The only signed-in human is Yossi (`yossib@tskeng-il.co.il`); he uses the app, under the rules. A non-Joe token may act only on its own `source`. The Joe token may act on any source.

| Actor | `addTask` (own source) | `updateTask` of own-source task | `updateTask` / `setDue` of another bot's task | `markDone` | `approveTask` |
|---|---|---|---|---|---|
| `michal-mail`, `ron-site`, `noga-tour`, `ido`, `shaked`, `calendar-agent` token | yes | yes, if `awaitingReview` is still true (live corrections) | stored as an edit proposal, not applied | no (`403`); use `proposeDone` | no (`403`) |
| `joe` token | yes | yes | yes | yes | yes |
| Signed-in Yossi in the app | n/a (client SDK, not this endpoint) | yes (Firestore rules) | yes (rules) | yes (rules) | yes (rules) |

A non-Joe bot may update **its own** still-queued tasks so live corrections (especially Michal's mail) can amend a title or due date the same day. It may not mark them done, may not approve them, and may not edit another bot's tasks. Once a task has been approved (`awaitingReview: false`), further `updateTask` calls from a non-Joe source are rejected (`403`).

Yossi does not need a bot token for day-to-day work; he uses the app. If a `yossi` token is later added, it has the same powers as `joe` on this endpoint.

## 6. `awaitingReview`

- `addTask` through this endpoint always stores `awaitingReview: true` (the «ממתין לסקירה» queue). The bot cannot override this.
- Approval (`awaitingReview: false`): Yossi does it in the app (`approveTask` action, under rules). Joe does it on this endpoint (`op: approveTask`, Joe token only). Other bot tokens cannot approve.
- Manual creates from the app stay `awaitingReview: false`.


## 7. Live writes (michal-mail)

Michal scans the inbox **at most twice a day** (morning and midday digests). Each digest, **and** each small mid-day push she sends, is written via the Apps Script Web App `doPost` as one **idempotent single-task** write with `awaitingReview: true`, **immediately when she writes it** — never batched until end of day. A possible extra end-of-day run is [לא החלטי]. This is the live path.

**Deployment:** Execute as: me (`yossib@tskeng-il.co.il`). Who has access: Anyone. Protection is the **per-bot token** in Script Properties plus the rate limit — not a Google login. Apps Script has **no per-email Gmail trigger**, which is why **Michal** (not Gmail) is the caller.

**How the app sees it:** a Firestore realtime listener (PR1). Bridge latency is about **2–5 seconds per call** (estimate, [לאימות] until measured). **End-to-end latency from an email** is the time until Michal's next scan or mid-day push, plus that bridge latency.

**Failure path:** retry the same request with the **same `idempotencyKey`**. If the live POST still fails, write the item to the Drive queue `task-manager-updates`, which a **5-minute time trigger** drains (max about **5 minutes** to land). The existing triggers at **05:30 / 13:15 / 19:45 / 22:00** stay for diary sync and end-of-day close only; they are **not** the live path.

## 8. Idempotency store and audit log

Collection (indicative): `teams/main/idempotency/{hash}` where `hash` is a stable hash of `source + ":" + idempotencyKey`.

Document: `{ source, idempotencyKey, op, taskId, status, response, createdAt }`.

- On a repeated key with the **same** request fingerprint: return the stored response (`200`) and do not write the task again.
- On a repeated key with a **different** fingerprint: `409`.
- Records are retained at least 30 days [לאימות].

Audit collection: `teams/main/audit/{id}`.

Document: `{ at, source, op, taskId, idempotencyKey, result }` (ok / error code). Do **not** log task titles, notes, emails, or any private / financial content, and never log tokens or the service-account JSON.

Client SDK access: deny writes; team read of audit may be added later. The service account writes these documents.

## 9. Drive-queue compatibility (`task-manager-updates`)

Temporary adapter, not the source of truth.

- Accept the existing file operations `addTasks`, `markDone`, `setDue` plus `source`.
- Translate each item into a single endpoint operation with an `idempotencyKey` derived from the file id and item identity so a retried file does not duplicate tasks.
- Same validation, authorization, and `awaitingReview` rules as a live POST.
- A time-driven Apps Script trigger, or a small watcher on Joe's side, may poll the folder. Either way, the folder is a queue only.
- Remove the adapter in a later PR after Yossi confirms all writers use HTTP.

## 10. Rate limit and error codes

Default: 60 requests per token per minute [לאימות]. Burst of a Drive-queue flush should stay under this or use a documented higher cap for the `joe` token.

Clients MUST decide by the JSON body field `code` (`ok`, `migration_pending`, `unauthorized`, `forbidden`, `invalid`, `not_found`, `conflict`, `rate_limited`, `internal`), not by the HTTP status line. Verified on the live Apps Script web app: every contract error is still HTTP 200, and the code is only in the body. The numbers in the table are logical statuses for that `code`. They are not what `POST /exec` returns.

`POST /exec` answers **302** to a `googleusercontent` echo URL. Clients must follow that redirect with **GET** (the default for `urllib` and for `fetch`) and must not re-POST the body.

| Logical status | `code` | When |
|---|---|---|
| 200 | `ok` | Write applied, or idempotent replay of a successful write. |
| 400 | `invalid` | Schema / enum / duration / due validation failed. |
| 401 | `unauthorized` | Missing or unknown token. |
| 403 | `forbidden` | Source mismatch, rule 5, approve/markDone by a non-Joe token, or update of an already-approved task by a non-Joe bot. |
| 403 | `migration_pending` | `MIGRATION_DONE` is not `"true"`. |
| 404 | `not_found` | Task id does not exist. |
| 409 | `conflict` | Idempotency key reused with a different payload. |
| 429 | `rate_limited` | Token exceeded the rate limit. |
| 500 | `internal` | Unexpected failure. Log only the error code and `idempotencyKey`, never secrets. |

Response body: `{ ok: boolean, code: string, taskId?: string, error?: string }`.

### Idempotency key guidance

A key must identify **one intended write**, not a day. The same key with the same payload returns the cached result and does not write again. The same key with a different payload is `conflict` (logical 409). A key such as `<source>:<date>:<taskId>:setDue:<due>` is wrong: A→B→A on the same day silently drops the last write, because the second A matches the first key and payload. Recommended: `<source>:<run-or-message-id>:<item-index-or-id>:<op>`. The run id stays stable across retries of that batch (for example a hash of the input file) and is new for a new batch.

## 11. Existing writers — freeze and convert

These writers today write Firestore **directly** (the `teams/main.state` blob, via a service account). Direct writes bypass Firestore rules, so they must not continue after the split. They are frozen for the PR3 migration window and converted onto this single bridge in PR2, with no leftover direct path.

### `tasks_app.py` (Joe's box, `/home/box/tools/tasks_app.py`)

- Today: `export`, and `apply` with `markDone` / `setDue` / `addTasks`; transaction on `state`; backups under `/home/box/tools/tasks_backups`; supports dry-run.
- Uses secret `FIREBASE_TASKS_SA_JSON` (never read or print).
- PR2: talk to this endpoint only (per-task documents + `idempotencyKey`). Keep dry-run. Direct SA writes to the blob are removed.
- Migration window: freeze `apply` (export/backup may remain).

### «גשר משימות»

- This is the legacy Apps Script. Its triggers were deleted for the freeze.
- Only `exportTasks` is restored afterwards.

### Cut-over order

1. Ship PR2 behind a flag or unreleased URL; keep current writers as they are until conversion is verified.
2. Convert `tasks_app.py` to this bridge (own token; no direct SA writes), with dry-run comparison.
3. Freeze bot writers for the PR3 window: the «גשר משימות» triggers are deleted, `tasks_app.py` `apply` is frozen, the Drive queue is paused, and leftover direct SA writes are disabled. Only `exportTasks` is restored afterwards.
4. Run the approved migration (PR3, currently on hold).
5. After Yossi approves: unfreeze writers onto this endpoint only.

## 12. What PR2 implements (and what it does not)

Implements: the Apps Script `doPost` handler (including the per-task ordering guarantee), Script Property setup instructions (no secret values), token check, validation, authorization matrix (Joe token vs other bots), idempotency, audit, rate limit, Firestore per-task writes, Drive-queue adapter, a small bot client used by converted writers, and the freeze of `tasks_app.py` plus the legacy script «גשר משימות» (triggers deleted; only `exportTasks` restored).

Does not: deploy without Yossi's approval; merge to `main`; delete the legacy `state` blob; read or print secrets; change UI files; change this contract (that is an Ido contract PR only).

## 13. Implementation notes (PR2 code)

Code lives in `bridge/` (`logic.js` + `Code.gs`) with clients `bot-client.js` and `bot_client.py`. Setup, property names, and the conversion steps for `tasks_app.py` are in `bridge/README.md`. This PR does not deploy the web app and does not modify the live `tasks_app.py`.

**Pre-migration flag.** Script Property `MIGRATION_DONE` must be `"true"` before the bridge will write. Until then every authenticated request is refused with body `code: "migration_pending"` (logical 403). The live web app still returns HTTP 200 for that body; clients must not look at the HTTP status line. This is the safe option: the bridge never writes the legacy `teams/main.state` blob (the overwrite risk). Existing writers stay on their current paths until they are frozen for PR3; after a successful migration and Yossi's approval, set the flag and unfreeze them onto this endpoint only.

A `yossi` token, if added later, has the same authorization as the Joe token on this endpoint.

## Migration closure conditions

`MIGRATION_DONE` stays unset, and the migration is not closed, until every item below is true. Until then there is not a single write path.

- (a) The `applyUpdates` / `updates-*.json` path is **frozen, not deleted** (Yossi, 24/11/2026). The switch is `APPLY_FROZEN` in Joe's `tasks_app.py` (outside this repo). It is turned on at migration step 6 (freeze writers) and stays on. Files stay in place as a backup for 2 weeks from the migration date. Deletion only with Yossi's explicit approval then.
- (b) The Drive queue is paused, or it is drained only through this bridge.
- (c) The legacy Apps Script «גשר משימות» had its triggers deleted for the freeze. Only `exportTasks` is restored afterwards.
- (d) `tasks_app.py` is converted onto this bridge.

## Decision: freeze updates-*.json / applyUpdates

**Decided (Yossi, 24/11/2026): freeze, do not delete.** The switch is `APPLY_FROZEN` in Joe's `tasks_app.py` (outside this repo). It is turned on at migration step 6 (freeze writers) and stays on. Until then `applyUpdates` keeps running. Files stay in place as a backup for 2 weeks from the migration date. Deletion only with Yossi's explicit approval then. The Drive queue remains a fallback drained through the bridge.
