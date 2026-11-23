# Task board contract — מנהל המשימות

Locked in PR0. Change this contract only in an Ido PR that Yossi has approved.
Decisions below are Yossi's (23/11/2026, Asia/Jerusalem). Temporary name is no longer in use: the app name is **מנהל המשימות**.

This file is the shared source of truth for data shape, urgency, UI-callable APIs, file ownership, and merge order. Implementation of writes (PR1), bot ingress (PR2), and migration (PR3) must follow it. UI work (PR4–PR5) may use a mock of this interface until the data layer lands.

## 1. Task document

Path: `teams/main/tasks/{id}`.

| Field | Required | Type / values | Notes |
|---|---|---|---|
| `id` | yes | string | Preserve existing `t_…` ids. |
| `title` | yes | string | |
| `status` | yes | `todo` \| `doing` \| `done` | |
| `priority` | yes | `high` \| `mid` \| `low` | |
| `projectId`, `cityId`, `areaId` | yes | string | Existing ids (`p_` / `c_` / `a_`, or `area_office`, etc.). |
| `due` | yes | ISO `YYYY-MM-DD` or `""` | Empty means no due date. |
| `durationMin`, `durationMax` | yes | integer minutes | Always a range: `1 ≤ min ≤ max ≤ 14400` (30 work days of 8 hours = 10 calendar days of 24h). When equal, UI shows one number. |
| `durationUnit` | no | `min` \| `hour` \| `day` | Display preference only (the unit picked in the form). Stored duration stays integer minutes. A day = 8 work hours = 480 minutes [לאימות]. |
| `source` | yes | see enum below | `""` = manual / unknown. |
| `createdBy` | yes | string | Source key or email. |
| `createdAt` | yes | ISO date or timestamp | |
| `updatedAt` | yes (on write) | server timestamp | |
| `idempotencyKey` | no | string | Required on bot writes; unique per source. |
| `awaitingReview` | yes | boolean | Default `true` for bot writes, `false` for manual. |
| `dupGroup`, `dupLabel` | no | string | Duplicate grouping (sketch). |
| `visibility` | no | `shared` \| `private` | Denormalized from the area/client/project for rules. |
| `owner` | no | email or `null` | Denormalized; private items are readable only by this owner. |

Preserved optional / legacy fields (do not drop): `assignee`, `notes`, `time`, `participants`, `emails` (`{title,url}[]`), `dependsOn` (`id[]`), `recur`, `pos`, and legacy `duration` (optional compatibility; migration sets `durationMin = durationMax = duration`, default 60).

Areas, clients, and projects stay on the team document. The new model does not store `tasks` arrays on those objects as source of truth. The legacy `teams/main` `state` blob is **not** deleted (see §8).

### `source` enum and Hebrew labels

| `source` | Label |
|---|---|
| `michal-mail` | מיכל · מייל |
| `ron-site` | רון · פיקוח |
| `noga-tour` | נגה · סיור |
| `joe` | ג'ו · סגירת יום |
| `ido` | עידו · פיתוח |
| `shaked` | שקד · ראש מטה |
| `calendar-agent` | יומן · סוכן |
| `yossi` | יוסי · האפליקציה |
| `""` | ידני / לא ידוע |

Bot sources are `michal-mail`, `ron-site`, `noga-tour`, `joe`, `ido`, `shaked`, `calendar-agent`. `shaked` is a bot source, not an approver: its tasks default `awaitingReview: true`. Client (signed-in user) creates may only use `""` or `yossi`. Bot sources are written only through the Apps Script endpoint (PR2).

## 2. Urgency (client-side only — never stored in Firestore)

Existing helpers stay unchanged:

- `TM.daysUntil(due) → number | null` — relative to the device's today.
- `TM.todoScore(task)` — `-daysUntil(due) + {high:7, mid:0, low:-7}[priority] + ageDays/4`.

New:

- `TM.urgencyOf(task, today?) → { bucket, score, daysUntil }`
  - `bucket`: `overdue` | `today` | `soon` (due in 1–3 days) | `later` (4+ days) | `none` (no due date / invalid).
  - `score`: same formula as `todoScore`, pinned to `today` when that argument is passed.
  - `daysUntil`: day difference used for the bucket (`null` when `bucket` is `none`).
- `TM.formatDuration(min, max[, unit])` or `TM.formatDuration(task)` — Hebrew with a unit, at most one decimal. Stored values stay integer minutes. If `unit` is passed, or `task.durationUnit` is set, show in that unit (`"5–10 דק׳"`, `"4–6 שע׳"`, `"2–3 ימים"`, one day `"1 יום"`). If no unit, auto-pick: `max < 60` → דק׳; both ends multiples of 480 and `max ≥ 480` → ימים; both ends multiples of 30 and `max ≥ 60` → שע׳; otherwise דק׳. Equal min/max shows one number. Accepts legacy `task.duration` when the range fields are absent. Empty string when the range is invalid.
- `TM.toMinutes(value, unit)` — `min` → value, `hour` → value × 60, `day` → value × 480 (8 work hours [לאימות]).
- `TM.isValidDuration(min, max)` — integers, `1 ≤ min ≤ max ≤ 14400`.

Store selectors (logic lives in `data.js` as pure helpers; `store.jsx` wraps them in PR1, not in PR0):

- `store.listByUrgency({ includeDone?: false })` — open **approved** tasks (`awaitingReview` is not true) that have a due date, sorted by `score` descending. Confirmed: the phone home and the default urgency list show the board, not the review queue. Pass `includeAwaitingReview: true` only when a caller explicitly wants queued items.
- `store.listTopUrgent({ limit: 3 })` — first `limit` results of the above (default 3, phone home uses 2–3). **Tasks with no due date are excluded**, even if their `todoScore` is high. **Unapproved (`awaitingReview: true`) tasks are excluded.**
- `store.listInbox()` — open tasks with `awaitingReview: true`.
- `listWaitingOnOthers` is deferred.

## 3. UI-callable interface

UI (Claude Code) may **call** these, and may not edit their implementing files. If a function is missing, Claude asks Ido; it does not add it to `store.jsx` or `data.js`.

From `store.jsx` / `data.js` (existing, plus the PR1 wrappers above):

- Hooks / navigation: `useStore`, `useRoute`, `go`.
- Actions: `addTask`, `updateTask`, `deleteTask`, `approveTask` (inbox → board: `awaitingReview` false), `resolveDup`, and the existing area / client / project actions.
- Selectors: `visibleTree`, `summarize`, `buildTodos` (or its area+urgency successor), `listByUrgency`, `listTopUrgent`, `listInbox`.
- `TM.*` listed in §2, plus `TM.SOURCES` / `TM.SOURCE_BY_KEY`, `TM.STATUS`, `TM.PRIORITY`, `TM.DURATION`, `TM.APP_NAME`, `TM.STATUSES`, `TM.PRIORITIES`, `TM.canSee`, `TM.formatHeDate`.

UI requirements agreed for PR4–PR5 (same visual language as the concept sketch, not the current dashboard): review queue, duplicates, board, source chips, urgency list, desktop table with a duration column, phone home with the top 2–3 urgent tasks, duration always captured as a range.

Sketch: https://cursor.com/canvas/store-a42c6161-6ada-4105-9179-315e46d1d769/ba7de791-e80e-4d93-bb59-516df1685d1d

## 4. File ownership — no overlap

| File | Owner | Notes |
|---|---|---|
| `cloud.jsx` | Ido only | Claude does not touch. |
| `store.jsx` | Ido only | Contract implementation (`useStore`, actions, selectors, existing `useRoute` / `go`). Claude only calls the interface. |
| `data.js` | Ido only | Urgency stays here. Claude calls contract APIs, does not edit. |
| `firebase-config.js` | Ido only | |
| `firestore.rules` | Ido only | Draft in PR0; deploy only after Yossi approves. |
| `index.html` | Ido | Firebase / SDK / `data.js` / `cloud.jsx` / `store.jsx` tags. Claude asks Ido for a new UI script tag. |
| `service-worker.js` | Ido | Cache list and version. Claude asks Ido when a UI asset is added. |
| `SETUP.md`, migration script, bot client, endpoint | Ido | |
| `views.jsx`, `components.jsx`, `styles.css`, `app.jsx`, `taskmap.jsx`, `tweaks-panel.jsx` | Claude Code | Sketch UI plus desktop table, duration range, phone home. |
| `manifest.webmanifest` | Claude Code | Name / colors; display name **מנהל המשימות**. |

Request a change to the other side's files; do not edit them. Only the owner changes the file, and only after Yossi's approval if the change amends this contract.

## 5. Branches and merge order

Branches: `ido/contract`, `ido/data-layer`, `ido/bot-writes`, `ido/migrate`, `claude/ui-sketch`.

- All work is on a branch and goes in as a PR. **No push or merge to `main` without Yossi's approval.**
- Merge order: **PR0 → PR1 → PR3 → PR2**.
  - PR3 is the migration window (§8). PR2 may be prepared in parallel after PR1, but bots write to the new collection only after a successful PR3 migration.
  - PR4–PR5 may be written against a mock once PR0 is merged. Live data only after PR1 (and after PR3 if real tasks are required).
- Whoever merges later rebases onto updated `main`.
- Conflicts in Ido's files: Claude does not resolve them by editing those files. Conflicts in Claude's files: Ido does not resolve them by editing those files.
- Claude does not push to `main` and does not merge.

## 6. Decisions (23/11/2026)

1. **Bot writes** go through the **existing Apps Script bridge**, extended with a **separate token per bot**. No Cloud Functions and no Blaze plan. The detailed endpoint spec is `BOT-WRITE-SPEC.md` on branch `ido/bot-writes-spec` (lands with PR2, not this PR).
2. **Known writers** that today write Firestore directly must be **frozen or converted before migration**: `tasks_app.py` (Joe's box, `/home/box/tools/tasks_app.py`; `export` / `apply` with `markDone` / `setDue` / `addTasks`; uses secret `FIREBASE_TASKS_SA_JSON` — never read or print it) and **`calendar-agent`**, which writes **directly to Firestore with a service account**. Its Apps Script is `Code.gs` in the calendar-agent folder (not in this repo; the folder is gitignored), two-way with triggers. Converting both to the single bridge is PR2 work; pausing them (including `calendar-agent`'s `Code.gs` triggers) is a prerequisite for the PR3 window.
3. **Private areas** are **enforced in Firestore rules by `owner`**. Task documents carry denormalized `visibility` / `owner`. Soft UI-only privacy is not enough after the split.
4. Bot-created tasks enter the **«ממתין לסקירה»** queue (`awaitingReview: true`) and move to the board only after approval. **Only Yossi and Joe may approve a task out of the queue.** A bot may edit **its own** task while `awaitingReview` is still true (needed for Michal's live mail corrections). **Michal's mail-derived updates arrive live all day**, not only at end of day: the write point must accept **single-task writes at any time**, and they must be **idempotent**. Phone top-urgent shows **approved tasks only**.
5. **Only Yossi and Joe** may mark done or edit a task inserted by another bot. The only human Google account is `yossib@tskeng-il.co.il` (Yossi); bots have no Google accounts, and Joe has no Google login. **Yossi** is enforced in Firestore rules by that email. **Joe** is a bridge token, and "Joe may approve / markDone / edit" is enforced in the bridge, not in rules. Service-account writes bypass rules and must go through the bridge (see §7).
6. **Temporary compatibility** with the Drive folder `task-manager-updates` (`addTasks` / `markDone` / `setDue` + `source`). The queue is **not** the source of truth; the endpoint (and then `teams/main/tasks/{id}`) is.
7. **Duration is always a range** `durationMin` / `durationMax`, stored as integer minutes (`1 ≤ min ≤ max ≤ 14400`, 30 work days of 8 hours = 10 calendar days of 24h). Optional `durationUnit` (`min` | `hour` | `day`) is the unit picked in the form and is display-only. A day = 8 work hours = 480 minutes [לאימות]. When min and max are equal, display one number.
8. App name: **מנהל המשימות**.
9. UI follows the concept sketch, plus the desktop duration column and the phone home of the top 2–3 urgent tasks, in the same visual language.

Client writes never replace the whole team `state` blob once PR1 lands (`setDoc` of the full blob with `merge: false` is the current overwrite risk). Legacy `teams/main` remains readable as a fallback and is not deleted by migration.

## 7. Write path decision

**Keep a single Apps Script bridge as the write point for all bots**, including `calendar-agent` and `tasks_app.py`. Bots do not write to Firestore directly — not even with a service account.

Reasons:

1. Service-account / Admin writes **bypass Firestore rules entirely**. A direct bot write would skip private-area owner enforcement and the "only Yossi / Joe may mark done or edit another bot's task" rule.
2. The bridge **serializes writes per task** with a transaction plus an `updatedAt` / version precondition and `idempotencyKey`, so write order is preserved and retries do not duplicate or clobber.
3. There is **one audit log** and **one token per bot**.

The speed cost is acceptable: writes are single-task and volume is low.

The **app UI (Yossi)** writes per-task documents **directly**, with transactions, **under the rules** (PR1). That path stays in the client; it is not routed through the bridge.

Joe's identity is a **bridge token**, not a Google login, so "Joe may approve / markDone" is enforced in the bridge. "Yossi" is enforced in rules by email (`yossib@tskeng-il.co.il`).

A bot may `proposeDone` or, when it does not own the task or the task is no longer `awaitingReview`, send `updateTask` / `setDue` as an edit proposal. Those writes append `proposals[]` and do not change `status` or the other fields. Only Joe or Yossi accept (accept of kind `done` is mark done) or reject. `listTasks` is the read for `tasks_app.py`. Examples are in `BOT-WRITE-SPEC.md`.

## 8. Migration (PR3) — constraints for later work

Script name (repo is flat): `migrate-tasks.js`.

1. Freeze every bot writer for the window, explicitly including:
   - the Drive queue `task-manager-updates`;
   - `tasks_app.py` (`apply`; export/backup may remain);
   - **`calendar-agent` as a direct Firestore writer** (service account) **and its `Code.gs` triggers**, which must be paused so two-way calendar sync cannot write during migration.
   PR2 converts both `calendar-agent` and `tasks_app.py` onto the single bridge (own token and source key; no leftover direct writes) before this window.
2. Backup: local JSON export + Drive copy, with a recorded SHA-256 checksum. No deletion.
3. Dry-run first: counts, missing fields, `duration` → range mapping, tasks missing `createdAt`. No Firebase writes in dry-run.
4. Write `teams/main/tasks/{id}` preserving `t_…` ids. Do **not** delete or thin the legacy `state` blob.
5. Verify counts against the backup (do not print private or financial task content in logs).
6. Rollback: app flag to read the blob only; the new collection remains but is unused. No automatic deletion.
7. After Yossi approves: unfreeze bot writers onto the new endpoint only.

## 9. Contract-change rule

Amendments require a PR by Ido and Yossi's explicit approval. A comment, a UI PR, or a bot-write PR cannot silently change this contract.
