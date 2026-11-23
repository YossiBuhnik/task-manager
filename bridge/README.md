# Bot-write bridge (PR2)

Apps Script Web App that is the **only** write point for bots. Do not deploy until Yossi approves. This folder has no secrets.

## Files

- `logic.js` — pure validation, authorization, idempotency, rate limit. Tests load this in Node. In Apps Script, add it as **Logic.gs** so `TMBridge` is a global.
- `Code.gs` — `doPost`, Firestore REST (per-task docs, idempotency, audit), optional `drainDriveQueue`.

## Script Properties (names only)

| Property | Purpose |
|---|---|
| `BOT_TOKENS` | JSON map `{ "<token>": { "source": "<source>", "name": "<bot>" } }` |
| `FIREBASE_SA_JSON` | Service-account JSON. Never log or commit. |
| `FIREBASE_PROJECT_ID` | Firebase project id |
| `RATE_LIMIT` | Optional; default 60 requests per token per minute |
| `MIGRATION_DONE` | `"true"` only after an approved migration and Yossi's approval |
| `DRIVE_QUEUE_FOLDER_ID` | Optional; folder for `drainDriveQueue` |

Deployment after approval: Execute as me (`yossib@tskeng-il.co.il`); Who has access: Anyone. Protection is the per-bot token plus the rate limit.

## Safe pre-migration behaviour

Until `MIGRATION_DONE` is `"true"`, the bridge **refuses** writes with `403 migration_pending`. It does **not** write the legacy `teams/main.state` blob (that is the overwrite risk). Existing writers keep using their current paths until they are frozen for the migration window, then converted onto this bridge after the flag is set.

After the flag is on, writes go only to `teams/main/tasks/{id}` (plus idempotency and audit). The blob is never modified here.

## Converting `tasks_app.py` (do not edit the live script in this PR)

Today, on Joe's box (`/home/box/tools/tasks_app.py`):

- `export` reads `teams/main.state` and prints open tasks.
- `apply FILE.json [--dry-run]` takes `{ markDone, setDue, addTasks }`, runs a transaction on the **blob**, backs up to `/home/box/tools/tasks_backups`, logs, supports dry-run.
- It uses the secret named `FIREBASE_TASKS_SA_JSON` (never read or print it).

Conversion (after an approved migration, on Joe's box, not in this repo):

1. Freeze `apply` for the migration window (export / backup may stay).
2. Point `apply` at `bot_client.py` with the **Joe token** and `source: "joe"`: each `addTasks` item becomes `add_task(...)`, each id in `markDone` becomes `mark_done(id)`, each `setDue` item becomes `set_due(id, due)`. Keep `--dry-run` (build the requests, do not POST). Generate a stable `idempotency_key` per item (for example `joe:apply:<backup-stamp>:<op>:<id-or-title-hash>`).
3. Keep local backups and the log. Stop all `transaction.update` of `state` and stop using the service account for writes.
4. After cut-over, `export` should list open tasks from the per-task collection (read-only) rather than the blob. A new export op on the bridge is out of scope; a read against `teams/main/tasks` is enough if it is approved. Do not give the converter a standing SA write.
5. Once the converted script is verified, remove leftover direct SA writes. Unfreeze only onto this endpoint.

The client hook `on_queue_fallback` may enqueue a Drive file in `task-manager-updates` if a live POST is exhausted; the 5-minute `drainDriveQueue` trigger will pick it up.

## Converting `calendar-agent`

Today it writes **directly to Firestore** with a service account. Its Apps Script is `Code.gs` in the gitignored `calendar-agent/` folder, two-way with triggers.

1. Stop all direct service-account writes.
2. Route creates / updates / due changes through this bridge with **its own token** and source `calendar-agent`. Use the calendar event id in `idempotencyKey`.
3. During the migration window, **pause its `Code.gs` triggers**. Leave them paused until Yossi approves the unfreeze onto the bridge only.
4. After cut-over it has no SA write of its own; only this bridge holds the service account.

## Shaked

`shaked` (שקד · ראש מטה) is a bot source, not an admin. It gets its own entry in the `BOT_TOKENS` Script Property (`source: "shaked"`). Do not commit token values. Shaked writes only when Yossi asks. Tasks it creates are stored with `awaitingReview: true`. It cannot `markDone`, `approveTask`, or edit another bot's task.

## Clients

- `../bot-client.js` and `../bot_client.py` — one method per op, auto `idempotencyKey`, retries with the **same** key, optional Drive-queue fallback hook.

## Migration closure conditions

Migration is not closed, and `MIGRATION_DONE` stays unset, until all of these are true:

- (a) The `applyUpdates` / `updates-*.json` path is retired or frozen. That retirement is still pending Yossi's decision.
- (b) The Drive queue is paused, or it is drained only through this bridge.
- (c) `calendar-agent` is converted onto this bridge with its own token. Its direct service-account writes and its `Code.gs` triggers are removed.
- (d) `tasks_app.py` is converted onto this bridge.

Until then there is not a single write path.
