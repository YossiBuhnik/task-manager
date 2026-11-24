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

Until `MIGRATION_DONE` is `"true"`, the bridge **refuses** writes with body `code: "migration_pending"` (logical 403). It does **not** write the legacy `teams/main.state` blob (that is the overwrite risk). Existing writers keep using their current paths until they are frozen for the migration window, then converted onto this bridge after the flag is set.

After the flag is on, writes go only to `teams/main/tasks/{id}` (plus idempotency and audit). The blob is never modified here.

## How clients read a response

The live Apps Script web app returns **HTTP 200** for every contract error. Clients MUST decide by the JSON body `code` (`migration_pending`, `unauthorized`, `forbidden`, `invalid`, `conflict`, `rate_limited`, and the rest), not by the HTTP status line. The numbers in `BOT-WRITE-SPEC.md` §10 are logical statuses for that `code`.

`POST /exec` answers **302** to a `googleusercontent` echo URL. Follow it with **GET** (default `urllib` and `fetch` behaviour). Do not re-POST the body.

An idempotency key names one intended write, not a day. Same key + same payload is the cached result; same key + a different payload is `conflict`. Use `<source>:<run-or-message-id>:<item-index-or-id>:<op>`, with the run id stable across retries of that batch and new for a new batch. A key that includes only the date and the new due (`…:setDue:<due>`) drops A→B→A on the same day.

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

- (a) The `applyUpdates` / `updates-*.json` path is frozen, not deleted (Yossi, 24/11/2026). The switch is `APPLY_FROZEN` in Joe's `tasks_app.py` (outside this repo). It is turned on at migration step 6 (freeze writers) and stays on. Files stay in place as a backup for 2 weeks from the migration date. Deletion only with Yossi's explicit approval then.
- (b) The Drive queue is paused, or it is drained only through this bridge.
- (c) `calendar-agent` is converted onto this bridge with its own token. Its direct service-account writes and its `Code.gs` triggers are removed.
- (d) `tasks_app.py` is converted onto this bridge.

Until then there is not a single write path.

## עדכון הגשר אחרי מיזוג - מדריך ליוסי

אחרי כל מיזוג שמשנה את `bridge/logic.js` צריך לעדכן את הגשר ב-Apps Script. בעדכון רגיל מחליפים רק את Logic.gs. את Code.gs ואת Script Properties לא נוגעים, אלא אם ה-PR אומר במפורש אחרת. זה לוקח בערך 5 דקות.

1. פותחים בדפדפן, כשאתה מחובר ל-GitHub: https://github.com/YossiBuhnik/task-manager/blob/main/bridge/logic.js
2. לוחצים על הכפתור Copy raw file מעל הקוד, בצד ימין (אייקון של שני ריבועים). כל הקוד מועתק.
3. פותחים את פרויקט הגשר ב-https://script.google.com.
4. ברשימת הקבצים משמאל לוחצים על Logic.gs. לא על Code.gs.
5. מסמנים את כל התוכן (Ctrl+A), מדביקים (Ctrl+V), ושומרים (Ctrl+S או אייקון הדיסקט). אם מופיעה שגיאה אדומה, עוצרים ושולחים צילום מסך לעידו.
6. לוחצים למעלה מימין על Deploy ואז על Manage deployments.
7. בוחרים את הפרסום הקיים (Web app) ולוחצים על העיפרון (Edit). לא ללחוץ על New deployment, כי זה יוצר כתובת חדשה.
8. בתפריט Version בוחרים New version. שאר ההגדרות נשארות כמו שהן. בתיאור אפשר לכתוב מה השתנה.
9. לוחצים Deploy ואז Done. הכתובת שמסתיימת ב-`/exec` נשארת אותו דבר, ואין צורך לעדכן את הבוטים.
10. בדיקה: פותחים את כתובת ה-`/exec` בדפדפן. אמור להופיע `use POST`. אם זה מה שמופיע, סיימת.

אם משהו נראה אחרת ממה שכתוב כאן, עוצרים ושולחים צילום מסך לעידו.

## הרצת ההסבה - מדריך ליוסי

ההסבה מעתיקה את המשימות מתוך `teams/main.state` אל `teams/main/tasks/{id}`. המפתח של Firebase נשאר ב-Apps Script. את הבלוג עצמו לא משנים.

הפעם מעדכנים גם את Code.gs (הפונקציות `migrationDryRun` ו-`migrationRun`), לא רק את Logic.gs. אחרי ההדבקה עושים New version כמו במדריך למעלה.

1. Dry run: בתפריט Run בוחרים `migrationDryRun`. ב-Execution log מופיעות רק ספירות וקודי בעיה (למשל `missing-id` ומזהה), בלי כותרות ובלי הערות. נוצר Script Property בשם `MIGRATION_DRYRUN` עם hash של הבלוג והספירות. אין כתיבה ל-Firestore.
2. Freeze: מקפיאים כותבים לפני הריצה, לפי שלב 6. `APPLY_FROZEN` ב-`tasks_app.py`, תור ה-Drive, וטריגרים של calendar-agent. אם מישהו כותב לבלוג אחרי ה-dry run, הריצה תיעצר.
3. Run: בתפריט Run בוחרים `migrationRun`. אם הלוג אומר `missing_dry_run` או `hash_mismatch`, מריצים שוב dry run ואז שוב את הריצה. אם הלוג אומר `migration_done`, ההסבה כבר סומנה ולא רצה שוב.

הצלחה בלוג: שורה `written=… skipped=… failed=0`. נוצר `MIGRATION_RESULT` עם אותם מספרים וה-hash. מסמך נכתב רק אם אין עדיין מסמך עם אותו id (קיים נספר ב-skipped). `teams/main.state` לא משתנה. `MIGRATION_DONE` לא מופעל לבד. אחרי בדיקה ידנית מגדירים אותו ל-`true`.
