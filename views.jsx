// views.jsx — Dashboard, City, Project views + Task row
// Depends on: React, window.TM, window.useDragList, window.go, etc.

const { useState: vUseState, useMemo: vUseMemo, useEffect: vUseEffect } = React;

// ───────────────────────────────────────────────────────────
// SHARED: Top bar
// ───────────────────────────────────────────────────────────
function TopBar({ search, onSearchChange, theme, onToggleTheme }) {
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark"><window.BrandGlyph /></div>
        <span>{window.TM.APP_NAME}</span>
      </div>
      <div className="topbar-spacer" />
      <input
        className="search-input"
        placeholder="חיפוש בתחומים, מזמיני עבודה, פרויקטים ומשימות…"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
      />
      {onToggleTheme && (
        <button type="button" className="theme-toggle" onClick={onToggleTheme}
          aria-label={theme === "dark" ? "מצב יום" : "מצב לילה"} title={theme === "dark" ? "מצב יום" : "מצב לילה"}>
          {theme === "dark" ? window.Icon.sun : window.Icon.moon}
        </button>
      )}
    </header>
  );
}

// ───────────────────────────────────────────────────────────
// SHARED: breadcrumb
// ───────────────────────────────────────────────────────────
function Crumbs({ items }) {
  return (
    <nav className="crumbs">
      {items.map((it, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="sep">/</span>}
          {it.href
            ? <a href={"#" + it.href} onClick={(e) => { e.preventDefault(); window.go(it.href); }}>{it.label}</a>
            : <span className="current">{it.label}</span>}
        </React.Fragment>
      ))}
    </nav>
  );
}

// ───────────────────────────────────────────────────────────
// SEARCH MATCHER
// ───────────────────────────────────────────────────────────
function matchText(needle, haystack) {
  if (!needle) return true;
  return (haystack || "").toLowerCase().includes(needle.toLowerCase());
}

// ───────────────────────────────────────────────────────────
// DASHBOARD: TODO list (open tasks ranked by urgency, one column per תחום)
// ───────────────────────────────────────────────────────────
function dueLabel(due) {
  const n = window.TM.daysUntil(due);
  if (n < 0)   return { text: `באיחור ${-n === 1 ? "יום" : -n + " ימים"}`, cls: "is-overdue" };
  if (n === 0) return { text: "היום", cls: "is-soon" };
  if (n === 1) return { text: "מחר", cls: "is-soon" };
  return { text: `בעוד ${n} ימים`, cls: n <= 3 ? "is-soon" : "" };
}

// Small icons beside a task: repeats (tooltip = rule) and linked email threads.
// One thread links straight to it; several expand the row (onShowAll).
function TaskBadges({ task, project, onShowAll }) {
  const emails = task.emails || [];
  const waitingOn = project && task.status !== "done" ? window.TM.blockersOf(task, project.tasks) : [];
  return (
    <>
      {waitingOn.length > 0 && (
        <span className="task-badge is-blocked" title={"ממתינה ל: " + waitingOn.map(b => b.title).join(", ")}>
          {window.Icon.lock}<span>{waitingOn.length}</span>
        </span>
      )}
      {task.recur && (
        <span className="task-badge" title={window.TM.recurLabel(task.recur)}>{window.Icon.repeat}</span>
      )}
      {emails.length === 1 && (
        <a className="task-badge is-link" href={emails[0].url} target="_blank" rel="noopener noreferrer"
          title={"פתח מייל: " + emails[0].title} onClick={(e) => e.stopPropagation()}>{window.Icon.mail}</a>
      )}
      {emails.length > 1 && (
        <button type="button" className="task-badge is-link" title={emails.length + " שרשורי מייל"}
          onClick={(e) => { e.stopPropagation(); onShowAll && onShowAll(); }}>
          {window.Icon.mail}<span>{emails.length}</span>
        </button>
      )}
    </>
  );
}

function clientMatches(q, city, projects) {
  if (city.name.toLowerCase().includes(q)) return true;
  return projects.some(p =>
    p.name.toLowerCase().includes(q) ||
    (p.summary || "").toLowerCase().includes(q) ||
    p.tasks.some(t =>
      t.title.toLowerCase().includes(q) ||
      (t.assignee || "").toLowerCase().includes(q) ||
      (t.notes || "").toLowerCase().includes(q) ||
      (t.emails || []).some(e => e.title.toLowerCase().includes(q))
    )
  );
}

// No-access / not-found placeholder
function NoAccess({ title, text, back = "/" }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      <button className="btn" onClick={() => window.go(back)}>חזרה</button>
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// DASHBOARD VIEW — list of תחומים
// ───────────────────────────────────────────────────────────
// Dashboard banner: greeting by time of day + what needs attention today.
// ───────────────────────────────────────────────────────────
// TASK BOARD (concept sketch): overview tiles, review inbox with
// duplicate actions, board grouped by area / status, reminders and
// waiting-on-others lists. Reads through the contract only.
// ───────────────────────────────────────────────────────────

// Every visible task with its area / client / project, so the board never
// shows what visibleTree hides (private areas).
function boardRows(data, userEmail) {
  const rows = [];
  for (const { area, clients } of window.visibleTree(data, userEmail))
    for (const { city, projects } of clients)
      for (const project of projects)
        for (const task of project.tasks)
          rows.push({ task, area, city, project, urg: window.TM.urgencyOf(task) });
  return rows;
}

function rowMatches(q, r) {
  if (!q) return true;
  const hay = [r.task.title, r.task.assignee, r.project.name, r.city.name, r.area.name, r.task.notes]
    .filter(Boolean).join(" ").toLowerCase();
  return hay.includes(q.toLowerCase());
}

const URGENT_BUCKETS = { overdue: 1, today: 1, soon: 1 };
const isOpenRow = (r) => r.task.status !== "done";
const isBoardRow = (r) => !r.task.awaitingReview;

// "Waiting on others": open, and waitingOn is set, or status is "waiting".
// Assignee and bot source do not count.
function isWaitingRow(r) {
  return window.TM.isWaitingOnOthers(r.task);
}

function boardDue(task) {
  if (!task.due) return "";
  const n = window.TM.daysUntil(task.due);
  if (n === 0) return "היום";
  if (n === 1) return "מחר";
  if (n < 0) return `באיחור ${-n === 1 ? "יום" : -n + " ימים"}`;
  return new Date(task.due).toLocaleDateString("he-IL", { day: "numeric", month: "short" });
}

function DueText({ task, urg }) {
  const txt = boardDue(task);
  if (!txt) return null;
  const cls = urg.bucket === "overdue" ? "is-overdue" : (urg.bucket === "today" || urg.bucket === "soon") ? "is-soon" : "";
  return <span className={"due " + cls}>{window.Icon.cal}{txt}{task.time ? " · " + task.time : ""}</span>;
}

function TaskCard({ row, onOpen, compact, showDuration }) {
  const { task, area, city, project, urg } = row;
  const dup = !!(task.dupGroup || task.dupLabel);
  const cls = ["tcard",
    urg.bucket === "overdue" && task.status !== "done" ? "is-overdue" : "",
    dup ? "is-dup" : "",
    task.status === "done" ? "is-done" : "",
    "tone-" + window.areaTone(area.id)].filter(Boolean).join(" ");
  const meta = [project.name, city.name].filter(Boolean);
  return (
    <div className={cls} role="button" tabIndex={0} onClick={() => onOpen(row)}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen(row); }}>
      {(task.source || dup) && (
        <div className="tcard-top">
          <window.SourceChip source={task.source} />
          <window.DupChip task={task} />
        </div>
      )}
      <div className="tcard-title">{task.title}</div>
      {!compact && (
        <div className="tcard-chips">
          <window.AreaChip area={area} />
          <window.PriorityChip priority={task.priority} />
          <window.StatusChip status={task.status} />
        </div>
      )}
      <div className="tcard-meta">
        {meta.map((m, i) => <span key={i}>{m}</span>)}
        <DueText task={task} urg={urg} />
        {task.assignee && <span className="who">{task.assignee}</span>}
        {showDuration && window.formatDurationHe(task) && <span className="dur">{window.formatDurationHe(task)}</span>}
      </div>
    </div>
  );
}

function StatTile({ label, value, sub, tone, active, onClick }) {
  return (
    <button type="button" className={"stat tone-" + tone + (active ? " is-active" : "")} onClick={onClick}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </button>
  );
}

function Segmented({ value, options, onChange, label }) {
  return (
    <div className="seg" role="tablist" aria-label={label}>
      {options.map(o => (
        <button key={o.key} type="button" role="tab" aria-selected={value === o.key}
          className={value === o.key ? "is-active" : ""} onClick={() => onChange(o.key)}>{o.label}</button>
      ))}
    </div>
  );
}

// ── Inbox: «חדש מהבוטים / ממתין לסקירה» ──
function DupPair({ rows, actions, onOpen }) {
  const [a, b] = rows;
  const del = (r) => actions.deleteTask(r.city.id, r.project.id, r.task.id);
  const clear = (r) => actions.resolveDup(r.task.id, {});
  const keep = (win, lose) => {
    if (!confirm(`להשאיר את «${win.task.title}» ולמחוק את «${lose.task.title}»?`)) return;
    del(lose); clear(win);
  };
  const merge = () => {
    if (!confirm(`למזג את «${b.task.title}» לתוך «${a.task.title}»? המשימה השנייה תימחק.`)) return;
    const A = a.task, B = b.task;
    const rank = { high: 0, mid: 1, low: 2 };
    const dues = [A.due, B.due].filter(Boolean).sort();
    const seen = new Set((A.emails || []).map(e => e.url));
    const fields = {
      notes: [A.notes, B.notes && `מוזג מ«${B.title}»: ${B.notes}`].filter(Boolean).join("\n"),
      emails: [...(A.emails || []), ...(B.emails || []).filter(e => !seen.has(e.url))],
      priority: rank[B.priority] < rank[A.priority] ? B.priority : A.priority,
      due: dues[0] || "",
      assignee: A.assignee || B.assignee || "",
    };
    actions.updateTask(a.city.id, a.project.id, A.id, fields);
    del(b); clear(a);
  };
  const keepBoth = () => { clear(a); clear(b); };
  return (
    <div className="dup-pair">
      <div className="dup-head">
        <span className="chip chip-dup">כפילות אפשרית</span>
        <span className="dup-label">{a.task.dupLabel || b.task.dupLabel || "שתי משימות דומות"}</span>
      </div>
      <div className="dup-cards">
        {[a, b].map((r, i) => (
          <div key={r.task.id} className="dup-slot">
            <span className="dup-letter">{i === 0 ? "א׳" : "ב׳"}{!r.task.awaitingReview && " · כבר בלוח"}</span>
            <TaskCard row={r} onOpen={onOpen} />
          </div>
        ))}
      </div>
      <div className="dup-actions">
        <button className="btn btn-sm" onClick={() => keep(a, b)}>השאר את א׳</button>
        <button className="btn btn-sm" onClick={() => keep(b, a)}>השאר את ב׳</button>
        <button className="btn btn-sm" onClick={merge}>מזג</button>
        <button className="btn btn-sm btn-ghost" onClick={keepBoth}>השאר את שתיהן</button>
      </div>
    </div>
  );
}

function InboxItem({ row, actions, onOpen }) {
  const reject = () => {
    if (confirm(`לדחות ולמחוק את «${row.task.title}»?`))
      actions.deleteTask(row.city.id, row.project.id, row.task.id);
  };
  return (
    <div className="inbox-item">
      <TaskCard row={row} onOpen={onOpen} />
      <div className="inbox-actions">
        <button className="btn btn-sm btn-primary" onClick={() => actions.approveTask(row.task.id)}>
          {window.Icon.check}<span>אישור ותיוק</span>
        </button>
        <button className="btn btn-sm" onClick={() => onOpen(row)}>{window.Icon.edit}<span>עריכה</span></button>
        <button className="btn btn-sm btn-ghost" onClick={reject}>דחייה</button>
      </div>
    </div>
  );
}

function Inbox({ rows, allRows, actions, onOpen }) {
  // Duplicate groups that touch the queue; the other member may already be on the board.
  const groups = new Map();
  for (const r of allRows) {
    if (!r.task.dupGroup || !isOpenRow(r)) continue;
    if (!groups.has(r.task.dupGroup)) groups.set(r.task.dupGroup, []);
    groups.get(r.task.dupGroup).push(r);
  }
  const pairs = [], inPair = new Set();
  for (const g of groups.values()) {
    if (g.length < 2 || !g.some(r => r.task.awaitingReview)) continue;
    const two = g.slice(0, 2);
    pairs.push(two);
    two.forEach(r => inPair.add(r.task.id));
  }
  const singles = rows.filter(r => !inPair.has(r.task.id));
  return (
    <section className="panel inbox" id="inbox">
      <div className="panel-head">
        <h2>חדש מהבוטים <span className="muted">/ ממתין לסקירה</span></h2>
        <span className="count">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <div className="panel-empty">אין משימות שממתינות לסקירה.</div>
      ) : (
        <div className="inbox-list">
          {pairs.map(p => <DupPair key={p[0].task.dupGroup} rows={p} actions={actions} onOpen={onOpen} />)}
          {singles.map(r => <InboxItem key={r.task.id} row={r} actions={actions} onOpen={onOpen} />)}
        </div>
      )}
    </section>
  );
}

// ── Board ──
const byUrgency = (a, b) => b.urg.score - a.urg.score
  || (a.task.due ? 0 : 1) - (b.task.due ? 0 : 1);

function Board({ rows, tree, groupBy, onGroupBy, onOpen, filter, onClearFilter, extraControls, showGroup = true, children }) {
  const columns = vUseMemo(() => {
    if (groupBy === "status") {
      return window.TM.STATUSES.map(s => {
        const items = rows.filter(r => r.task.status === s.key).sort(byUrgency);
        return { key: s.key, title: s.label, tone: "st-" + s.key, items: s.key === "done" ? items.slice(0, 8) : items, more: s.key === "done" ? Math.max(0, items.length - 8) : 0 };
      });
    }
    return tree.map(({ area }) => ({
      key: area.id, title: area.name, tone: "tone-" + window.areaTone(area.id),
      items: rows.filter(r => r.area.id === area.id && isOpenRow(r)).sort(byUrgency), more: 0,
    })).filter(c => c.items.length || !String(c.key).startsWith("__"));
  }, [rows, tree, groupBy]);

  return (
    <section className="panel board">
      <div className="panel-head">
        <h2>לוח המשימות</h2>
        {filter && (
          <button className="chip chip-filter" onClick={onClearFilter}>{filter.label}{window.Icon.x}</button>
        )}
        <span className="spacer" />
        {extraControls}
        {showGroup && (
          <Segmented label="קיבוץ" value={groupBy} onChange={onGroupBy}
            options={[{ key: "area", label: "לפי תחום" }, { key: "status", label: "לפי סטטוס" }]} />
        )}
      </div>
      {children || (
        <div className="board-cols">
          {columns.map(col => (
            <div key={col.key} className={"board-col " + col.tone}>
              <div className="board-col-head">
                <span className="dot" />
                <span className="name">{col.title}</span>
                <span className="count">{col.items.length + col.more}</span>
              </div>
              <div className="board-col-body">
                {col.items.length === 0 && <div className="panel-empty">אין משימות</div>}
                {col.items.map(r => <TaskCard key={r.task.id} row={r} onOpen={onOpen} showDuration />)}
                {col.more > 0 && <div className="col-more">ועוד {col.more} שהושלמו</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function RowList({ title, rows, empty, onOpen, render }) {
  return (
    <section className="panel rowlist">
      <div className="panel-head">
        <h2>{title}</h2>
        <span className="count">{rows.length}</span>
      </div>
      {rows.length === 0 ? <div className="panel-empty">{empty}</div> : (
        <ul>
          {rows.map(r => (
            <li key={r.task.id}>
              <button type="button" className={"rl-row tone-" + window.areaTone(r.area.id)} onClick={() => onOpen(r)}>
                <span className="rl-bar" />
                <span className="rl-main">
                  <span className="rl-title">{r.task.title}</span>
                  <span className="rl-sub">{[r.project.name, r.city.name].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="rl-side">{render(r)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Desktop: consolidated table with a duration-range column ──
function TaskTable({ rows, onOpen }) {
  const sorted = rows.filter(isOpenRow).slice().sort(byUrgency);
  if (!sorted.length) return <div className="panel-empty">אין משימות</div>;
  return (
    <div className="ttable-wrap">
      <table className="ttable">
        <thead>
          <tr>
            <th>משימה</th><th>מקור</th><th>תחום</th><th>פרויקט · מזמין</th>
            <th>סטטוס</th><th>עדיפות</th><th>יעד</th><th>משך</th><th>אחראי</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(r => {
            const { task, urg } = r;
            const cls = [urg.bucket === "overdue" ? "is-overdue" : "", (task.dupGroup || task.dupLabel) ? "is-dup" : ""].join(" ");
            return (
              <tr key={task.id} className={cls} tabIndex={0} onClick={() => onOpen(r)}
                onKeyDown={(e) => { if (e.key === "Enter") onOpen(r); }}>
                <td className="tt-title">{task.title} <window.DupChip task={task} /></td>
                <td>{task.source ? <window.SourceChip source={task.source} /> : <span className="muted">—</span>}</td>
                <td><window.AreaChip area={r.area} /></td>
                <td className="tt-sub">{[r.project.name, r.city.name].filter(Boolean).join(" · ")}</td>
                <td><window.StatusChip status={task.status} /></td>
                <td><window.PriorityChip priority={task.priority} /></td>
                <td>{task.due ? <DueText task={task} urg={urg} /> : <span className="muted">ללא</span>}</td>
                <td className="tt-dur">{window.formatDurationHe(task) || "—"}</td>
                <td className="who">{task.assignee || ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Phone home: only the 2–3 most urgent dated tasks, then a path to the board ──
function useNarrow(q = "(max-width: 640px)") {
  const [narrow, setNarrow] = vUseState(() => !!(window.matchMedia && window.matchMedia(q).matches));
  vUseEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(q);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [q]);
  return narrow;
}

function PhoneHome({ allRows, inboxCount, onOpen, onShowBoard, actions }) {
  // Contract helper on the visible set (private areas stay hidden):
  // approved, open, dated tasks only, by urgency score.
  const byId = new Map(allRows.map(r => [r.task.id, r]));
  const top = window.TM.listTopUrgent(allRows.map(r => r.task), { limit: 3 }).map(t => byId.get(t.id));
  const undated = allRows.filter(r => isOpenRow(r) && isBoardRow(r) && !r.task.due).length;
  const markDone = (r) => actions.updateTask(r.city.id, r.project.id, r.task.id, { status: "done" });
  return (
    <div className="phone-home">
      <h1 className="tb-title">מה הכי דחוף עכשיו</h1>
      <p className="ph-sub">{new Date().toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" })}</p>
      {top.length === 0 ? (
        <div className="panel-empty">אין משימות פתוחות עם תאריך יעד.</div>
      ) : (
        <ol className="ph-list">
          {top.map((r, i) => (
            <li key={r.task.id} className="ph-item">
              <span className="ph-rank">{i + 1}</span>
              <div className="ph-card">
                <TaskCard row={r} onOpen={onOpen} showDuration />
                <button className="btn btn-sm ph-done" onClick={() => markDone(r)}>{window.Icon.check}<span>בוצע</span></button>
              </div>
            </li>
          ))}
        </ol>
      )}
      <div className="ph-more">
        {undated > 0 && <span>עוד {undated} משימות פתוחות ללא תאריך יעד</span>}
        {inboxCount > 0 && <span className="ph-inbox">{inboxCount} ממתינות לסקירה</span>}
      </div>
      <button className="btn btn-primary ph-board" onClick={onShowBoard}>ללוח המלא</button>
    </div>
  );
}

const TILE_FILTERS = {
  urgent:  { label: "דחוף פתוח",     test: (r) => isOpenRow(r) && !!URGENT_BUCKETS[r.urg.bucket] },
  doing:   { label: "בתהליך",        test: (r) => r.task.status === "doing" },
  waiting: { label: "ממתין לאחרים",  test: null },
};

function TaskBoard({ data, actions, search, userEmail, userName }) {
  const [groupBy, setGroupBy] = vUseState(() => {
    try { return localStorage.getItem("tm_board_group") || "area"; } catch (e) { return "area"; }
  });
  const [tile, setTile] = vUseState(null);
  const [editing, setEditing] = vUseState(null);
  const [view, setView] = vUseState(() => {
    try { return localStorage.getItem("tm_board_view") || "cards"; } catch (e) { return "cards"; }
  });
  const setBoardView = (v) => { setView(v); try { localStorage.setItem("tm_board_view", v); } catch (e) {} };
  const narrow = useNarrow();
  // Phone: the app opens on the top-urgent list; the full board is one tap away
  // (remembered for this browser session only).
  const [fullOnPhone, setFullOnPhone] = vUseState(() => {
    try { return sessionStorage.getItem("tm_phone_full") === "1"; } catch (e) { return false; }
  });
  const showFull = (v) => { setFullOnPhone(v); try { sessionStorage.setItem("tm_phone_full", v ? "1" : ""); } catch (e) {} };
  const me = (userName || "").split(" ")[0];
  const setGroup = (g) => { setGroupBy(g); try { localStorage.setItem("tm_board_group", g); } catch (e) {} };

  const tree = vUseMemo(() => window.visibleTree(data, userEmail), [data, userEmail]);
  const allRows = vUseMemo(() => boardRows(data, userEmail), [data, userEmail]);
  const rows = vUseMemo(() => allRows.filter(r => rowMatches(search, r)), [allRows, search]);

  const inbox = rows.filter(r => r.task.awaitingReview && isOpenRow(r));
  const board = rows.filter(isBoardRow);
  const open = board.filter(isOpenRow);
  const urgent = open.filter(TILE_FILTERS.urgent.test);
  const overdue = urgent.filter(r => r.urg.bucket === "overdue").length;
  const doing = open.filter(TILE_FILTERS.doing.test);
  const waiting = board.filter(r => isWaitingRow(r, me));
  const reminders = open
    .filter(r => r.task.due && r.urg.daysUntil >= 0 && r.urg.daysUntil <= 7)
    .sort((a, b) => (a.task.due + (a.task.time || "")).localeCompare(b.task.due + (b.task.time || "")));

  const boardShown = !tile ? board
    : tile === "waiting" ? waiting
    : board.filter(TILE_FILTERS[tile].test);

  const toggle = (k) => setTile(t => t === k ? null : k);
  const openRow = (r) => setEditing(r);
  const scrollInbox = () => {
    const el = document.getElementById("inbox");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const modal = editing && (
    <window.TaskModal
      task={editing.task}
      context={{ area: editing.area, city: editing.city, project: editing.project }}
      projectTasks={editing.project.tasks}
      onClose={() => setEditing(null)}
      onSave={(fields) => {
        actions.updateTask(editing.city.id, editing.project.id, editing.task.id, fields);
        setEditing(null);
      }}
      onApprove={() => actions.approveTask(editing.task.id)}
      onDelete={() => actions.deleteTask(editing.city.id, editing.project.id, editing.task.id)}
    />
  );

  if (narrow && !fullOnPhone && !search) {
    return (
      <div className="tb">
        <PhoneHome allRows={allRows} inboxCount={inbox.length} onOpen={openRow}
          onShowBoard={() => showFull(true)} actions={actions} />
        {modal}
      </div>
    );
  }
  const tableOn = view === "table" && !narrow;

  return (
    <div className="tb">
      {narrow && (
        <button className="btn btn-sm ph-back" onClick={() => showFull(false)}>‹ הכי דחוף עכשיו</button>
      )}
      <div className="tb-head">
        <h1 className="tb-title">{new Date().toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" })}</h1>
      </div>

      <div className="stats">
        <StatTile tone="review" label="ממתין לסקירה" value={inbox.length} sub="מהבוטים" onClick={scrollInbox} />
        <StatTile tone="urgent" label="דחוף פתוח" value={urgent.length}
          sub={overdue ? `${overdue} באיחור` : "עד 3 ימים"} active={tile === "urgent"} onClick={() => toggle("urgent")} />
        <StatTile tone="doing" label="בתהליך" value={doing.length} active={tile === "doing"} onClick={() => toggle("doing")} />
        <StatTile tone="waiting" label="ממתין לאחרים" value={waiting.length} active={tile === "waiting"} onClick={() => toggle("waiting")} />
      </div>

      <div className={"tb-grid" + (tableOn ? " is-wide" : "")}>
        <div className="tb-main">
          <Inbox rows={inbox} allRows={rows} actions={actions} onOpen={openRow} />
          <Board rows={boardShown} tree={tree} groupBy={groupBy} onGroupBy={setGroup} onOpen={openRow}
            filter={tile ? TILE_FILTERS[tile] : null} onClearFilter={() => setTile(null)}
            showGroup={!tableOn}
            extraControls={!narrow && (
              <Segmented label="תצוגה" value={view} onChange={setBoardView}
                options={[{ key: "cards", label: "כרטיסים" }, { key: "table", label: "טבלה" }]} />
            )}>
            {tableOn && <TaskTable rows={boardShown} onOpen={openRow} />}
          </Board>
        </div>
        <aside className="tb-aside">
          <RowList title="תזכורות קרובות" rows={reminders.slice(0, 8)} empty="אין תזכורות בשבוע הקרוב"
            onOpen={openRow} render={(r) => <DueText task={r.task} urg={r.urg} />} />
          <RowList title="ממתין לאחרים" rows={waiting.slice(0, 8)} empty="אין משימות שממתינות לאחרים"
            onOpen={openRow} render={(r) => <span className="who">{r.task.assignee}</span>} />
        </aside>
      </div>

      {modal}
    </div>
  );
}

function DashboardView({ data, actions, search, userEmail, userName }) {
  const [collapsed, setCollapsed] = vUseState(false);
  const [showAreaModal, setShowAreaModal] = vUseState(false);
  const [editArea, setEditArea] = vUseState(null);
  const [confirmDel, setConfirmDel] = vUseState(null);

  const tree = vUseMemo(() => window.visibleTree(data, userEmail), [data, userEmail]);
  const drag = window.useDragList((from, to) => actions.reorderAreas(from, to));

  const filteredTree = vUseMemo(() => {
    if (!search) return tree;
    const q = search.toLowerCase();
    return tree.filter(({ area, clients }) =>
      area.name.toLowerCase().includes(q) ||
      clients.some(({ city, projects }) => clientMatches(q, city, projects)));
  }, [tree, search]);

  return (
    <>
      <TaskBoard data={data} actions={actions} search={search} userEmail={userEmail} userName={userName} />

      <div className="section">
        <div className="section-head">
          <window.CollapseToggle collapsed={collapsed} onToggle={() => setCollapsed(v => !v)} />
          <h2>תחומים ופרויקטים</h2>
          <span className="section-count">{filteredTree.length}</span>
          <div className="section-spacer" />
          <button className="btn btn-sm" onClick={() => setShowAreaModal(true)}>
            {window.Icon.plus}<span>הוסף תחום</span>
          </button>
        </div>

        {!collapsed && (
          filteredTree.length === 0 ? (
            <div className="empty">
              <h3>{search ? "לא נמצאו תוצאות" : "אין עדיין תחומים"}</h3>
              <p>{search ? "נסה ביטוי אחר" : "התחל בהוספת תחום — לדוגמה משרד, ניהול פרויקטים או הבטחת איכות"}</p>
              {!search && (
                <button className="btn btn-primary" onClick={() => setShowAreaModal(true)}>
                  {window.Icon.plus}<span>הוסף תחום</span>
                </button>
              )}
            </div>
          ) : (
            <div className="cards">
              {filteredTree.map(({ area, clients }) => {
                const projects = clients.flatMap(c => c.projects);
                const allTasks = projects.flatMap(p => p.tasks);
                const progress = window.TM.tasksProgress(allTasks);
                const realIdx = data.areas.indexOf(area);
                const canDrag = realIdx >= 0;
                const st = canDrag ? drag.stateFor(realIdx) : {};
                const color = window.TM.areaColorFor(area.id);
                return (
                  <div
                    key={area.id}
                    className={"card card-tinted "
                      + (st.isDragging ? "is-dragging " : "")
                      + (st.isOverAbove ? "drop-above " : "")
                      + (st.isOverBelow ? "drop-below " : "")}
                    style={{ "--area-color": color.bar, "--area-soft": color.soft, "--area-ink": color.ink }}
                    onClick={() => window.go("/area/" + area.id)}
                    {...(canDrag ? drag.handlers(realIdx) : {})}
                  >
                    <div className="card-head">
                      <div className="card-title-row">
                        <span className="card-chip" />
                        <h3 className="card-title">{area.name}</h3>
                        {area.visibility === "private" && (
                          <span className="vis-badge" title="תחום פרטי — רואה רק אתה">
                            {window.Icon.lock}
                          </span>
                        )}
                      </div>
                      {!area.isUnassigned && (
                        <div className="card-actions" onClick={(e) => e.stopPropagation()}>
                          <button className="btn btn-ghost btn-icon" title="עריכה"
                            onClick={() => setEditArea(area)}>{window.Icon.edit}</button>
                          <button className="btn btn-ghost btn-icon btn-danger" title="מחיקה"
                            onClick={() => setConfirmDel(area)}>{window.Icon.trash}</button>
                        </div>
                      )}
                    </div>
                    <div className="card-meta">
                      <span><strong>{clients.length}</strong> מזמיני עבודה</span>
                      <span><strong>{projects.length}</strong> פרויקטים</span>
                      <span><strong>{allTasks.length}</strong> משימות</span>
                    </div>
                    <window.Progress value={progress} />
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>

      {showAreaModal && (
        <window.AreaModal
          currentUserEmail={userEmail}
          showVisibility={!!userEmail}
          onSave={(fields) => { actions.addArea(fields.name, fields); setShowAreaModal(false); }}
          onClose={() => setShowAreaModal(false)}
        />
      )}
      {editArea && (
        <window.AreaModal
          area={editArea}
          currentUserEmail={userEmail}
          showVisibility={!!userEmail}
          onSave={(fields) => { actions.updateArea(editArea.id, fields); setEditArea(null); }}
          onClose={() => setEditArea(null)}
        />
      )}
      {confirmDel && (
        <window.ConfirmModal
          title="מחיקת תחום"
          message={`למחוק את התחום "${confirmDel.name}"? מזמיני העבודה והפרויקטים שבו לא יימחקו — הם יעברו ל"ללא תחום".`}
          confirmLabel="מחק"
          onConfirm={() => actions.deleteArea(confirmDel.id)}
          onClose={() => setConfirmDel(null)}
        />
      )}
    </>
  );
}

// ───────────────────────────────────────────────────────────
// AREA VIEW — מזמיני עבודה inside one תחום
// ───────────────────────────────────────────────────────────
function AreaView({ data, actions, search, areaId, userEmail }) {
  const [showModal, setShowModal] = vUseState(false);
  const [editCity, setEditCity] = vUseState(null);
  const [confirmDel, setConfirmDel] = vUseState(null);
  const drag = window.useDragList((from, to) => actions.reorderCities(from, to));

  const area = window.findArea(data, areaId);
  if (!area) return <NoAccess title="תחום לא נמצא" text="ייתכן שהתחום נמחק." />;
  if (!window.TM.canSee(area, userEmail)) return <NoAccess title="אין גישה" text="תחום זה פרטי למשתמש אחר." />;

  const node = window.visibleTree(data, userEmail).find(n => n.area.id === area.id);
  const clients = node ? node.clients : [];
  const q = (search || "").toLowerCase();
  const filtered = q ? clients.filter(({ city, projects }) => clientMatches(q, city, projects)) : clients;
  const allTasks = clients.flatMap(c => c.projects).flatMap(p => p.tasks);
  const progress = window.TM.tasksProgress(allTasks);
  const areaColor = window.TM.areaColorFor(area.id);
  const selectableAreas = data.areas.filter(a => window.TM.canSee(a, userEmail));

  return (
    <>
      <Crumbs items={[{ label: "סקירה", href: "/" }, { label: area.name }]} />
      <div className="page-head" style={{ "--hero": areaColor.bar }}>
        <div>
          <span className="area-pill"
            style={{ "--area-color": areaColor.bar, "--area-soft": areaColor.soft, "--area-ink": areaColor.ink }}>
            {area.visibility === "private" ? <>{window.Icon.lock}<span>תחום פרטי</span></> : "תחום"}
          </span>
          <h1 className="page-title">{area.name}</h1>
          <p className="page-sub">
            {clients.length} מזמיני עבודה · {allTasks.length} משימות · {progress}% התקדמות
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          {window.Icon.plus}<span>הוסף מזמין עבודה</span>
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="empty">
          <h3>{search ? "אין תוצאות תואמות" : "אין מזמיני עבודה בתחום זה"}</h3>
          {!search && (
            <button className="btn btn-primary" onClick={() => setShowModal(true)}>
              {window.Icon.plus}<span>הוסף מזמין עבודה</span>
            </button>
          )}
        </div>
      ) : (
        <div className="cards">
          {filtered.map(({ city, projects }) => {
            const tasks = projects.flatMap(p => p.tasks);
            const pct = window.TM.tasksProgress(tasks);
            const realIdx = data.cities.indexOf(city);
            const st = drag.stateFor(realIdx);
            const color = window.TM.areaColorFor(city.id);
            return (
              <div
                key={city.id}
                className={"card card-tinted "
                  + (st.isDragging ? "is-dragging " : "")
                  + (st.isOverAbove ? "drop-above " : "")
                  + (st.isOverBelow ? "drop-below " : "")}
                style={{ "--area-color": color.bar, "--area-soft": color.soft, "--area-ink": color.ink }}
                onClick={() => window.go("/city/" + city.id)}
                {...drag.handlers(realIdx)}
              >
                <div className="card-head">
                  <div className="card-title-row">
                    <span className="card-chip" />
                    <h3 className="card-title">{city.name}</h3>
                    {city.visibility === "private" && (
                      <span className="vis-badge" title="מזמין עבודה פרטי — רואה רק אתה">
                        {window.Icon.lock}
                      </span>
                    )}
                  </div>
                  <div className="card-actions" onClick={(e) => e.stopPropagation()}>
                    <button className="btn btn-ghost btn-icon" title="עריכה"
                      onClick={() => setEditCity(city)}>{window.Icon.edit}</button>
                    <button className="btn btn-ghost btn-icon btn-danger" title="מחיקה"
                      onClick={() => setConfirmDel(city)}>{window.Icon.trash}</button>
                  </div>
                </div>
                <div className="card-meta">
                  <span><strong>{projects.length}</strong> פרויקטים</span>
                  <span><strong>{tasks.length}</strong> משימות</span>
                </div>
                <window.Progress value={pct} />
              </div>
            );
          })}
        </div>
      )}

      {showModal && (
        <window.CityModal
          areas={selectableAreas}
          defaultAreaId={area.isUnassigned ? null : area.id}
          currentUserEmail={userEmail}
          userEmail={userEmail}
          onSave={(fields) => { actions.addCity(fields.name, fields); setShowModal(false); }}
          onClose={() => setShowModal(false)}
        />
      )}
      {editCity && (
        <window.CityModal
          city={editCity}
          areas={selectableAreas}
          currentUserEmail={userEmail}
          userEmail={userEmail}
          onSave={(fields) => { actions.updateCity(editCity.id, fields); setEditCity(null); }}
          onClose={() => setEditCity(null)}
        />
      )}
      {confirmDel && (
        <window.ConfirmModal
          title="מחיקת מזמין עבודה"
          message={`למחוק את "${confirmDel.name}" וכל הפרויקטים שלו?`}
          confirmLabel="מחק"
          onConfirm={() => actions.deleteCity(confirmDel.id)}
          onClose={() => setConfirmDel(null)}
        />
      )}
    </>
  );
}

// ───────────────────────────────────────────────────────────
// CITY VIEW
// ───────────────────────────────────────────────────────────
function CityView({ data, actions, search, cityId, userEmail }) {
  const [showModal, setShowModal] = vUseState(false);
  const [editProj, setEditProj] = vUseState(null);
  const [confirmDel, setConfirmDel] = vUseState(null);
  const city = window.findCity(data, cityId);
  const drag = window.useDragList((from, to) => actions.reorderProjects(cityId, from, to));

  if (!city) return <NoAccess title="מזמין עבודה לא נמצא" text="ייתכן שנמחק." />;
  const area = window.areaOf(data, city);
  // Block access to other people's private תחומים / מזמיני עבודה
  if (!window.TM.canSee(area, userEmail) || !window.TM.canSee(city, userEmail))
    return <NoAccess title="אין גישה" text="פריט זה פרטי למשתמש אחר." />;

  // hide other people's private projects
  const visibleProjects = city.projects.filter(p => window.TM.canSee(p, userEmail));

  const filtered = vUseMemo(() => {
    if (!search) return visibleProjects;
    const q = search.toLowerCase();
    return visibleProjects.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.summary || "").toLowerCase().includes(q) ||
      p.tasks.some(t => t.title.toLowerCase().includes(q))
    );
  }, [city.projects, search, userEmail]);

  const allTasks = visibleProjects.flatMap(p => p.tasks);
  const progress = window.TM.tasksProgress(allTasks);
  const cityColor = window.TM.areaColorFor(city.id);
  // Inside a private תחום / מזמין עבודה every project is already private — no need to ask.
  const showProjectVisibility = !!userEmail
    && area.visibility !== "private" && city.visibility !== "private";
  const projectFields = ({ name, summary, visibility, owner }) =>
    showProjectVisibility ? { name, summary, visibility, owner } : { name, summary };

  return (
    <>
      <Crumbs items={[
        { label: "סקירה", href: "/" },
        { label: area.name, href: "/area/" + area.id },
        { label: city.name },
      ]} />
      <div className="page-head" style={{ "--hero": cityColor.bar }}>
        <div>
          <span className="area-pill"
            style={{ "--area-color": cityColor.bar, "--area-soft": cityColor.soft, "--area-ink": cityColor.ink }}>
            {city.visibility === "private"
              ? <>{window.Icon.lock}<span>מזמין עבודה פרטי</span></>
              : "מזמין עבודה"}
          </span>
          <h1 className="page-title">{city.name}</h1>
          <p className="page-sub">
            {visibleProjects.length} פרויקטים · {allTasks.length} משימות · {progress}% התקדמות
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          {window.Icon.plus}<span>הוסף פרויקט</span>
        </button>
      </div>

      <div style={{ marginBottom: 24 }}>
        <window.Progress value={progress} size="lg" />
      </div>

      {filtered.length === 0 ? (
        <div className="empty">
          <h3>{search ? "אין פרויקטים תואמים" : "אין פרויקטים בתחום זה"}</h3>
          {!search && (
            <button className="btn btn-primary" onClick={() => setShowModal(true)}>
              {window.Icon.plus}<span>הוסף פרויקט ראשון</span>
            </button>
          )}
        </div>
      ) : (
        <div className="cards">
          {filtered.map((p) => {
            const pct = window.TM.tasksProgress(p.tasks);
            const realIdx = city.projects.indexOf(p);
            const st = drag.stateFor(realIdx);
            const counts = p.tasks.reduce((a, t) => { a[t.status]++; return a; },
              { todo: 0, doing: 0, done: 0 });
            return (
              <div
                key={p.id}
                className={"card "
                  + (st.isDragging ? "is-dragging " : "")
                  + (st.isOverAbove ? "drop-above " : "")
                  + (st.isOverBelow ? "drop-below " : "")}
                style={{ "--area-color": cityColor.bar, "--area-soft": cityColor.soft, "--area-ink": cityColor.ink }}
                onClick={() => window.go("/project/" + city.id + "/" + p.id)}
                {...drag.handlers(realIdx)}
              >
                <div className="card-head">
                  <div className="card-title-row">
                    <h3 className="card-title">{p.name}</h3>
                    {p.visibility === "private" && (
                      <span className="vis-badge" title="פרויקט פרטי — רואה רק אתה">
                        {window.Icon.lock}
                      </span>
                    )}
                  </div>
                  <div className="card-actions" onClick={(e) => e.stopPropagation()}>
                    <button className="btn btn-ghost btn-icon" title="עריכה"
                      onClick={() => setEditProj(p)}>{window.Icon.edit}</button>
                    <button className="btn btn-ghost btn-icon btn-danger" title="מחיקה"
                      onClick={() => setConfirmDel(p)}>{window.Icon.trash}</button>
                  </div>
                </div>
                {p.summary && <div style={{ color: "var(--ink-3)", fontSize: 13 }}>{p.summary}</div>}
                <div className="card-meta">
                  <span><strong>{p.tasks.length}</strong> משימות</span>
                  {counts.doing > 0 && <span>{counts.doing} בתהליך</span>}
                  {counts.done > 0 && <span>{counts.done} הושלמו</span>}
                </div>
                <window.Progress value={pct} />
              </div>
            );
          })}
        </div>
      )}

      {showModal && (
        <window.ProjectModal
          allowStandardTasks
          currentUserEmail={userEmail}
          showVisibility={showProjectVisibility}
          onSave={(fields) => {
            const { name, summary, withStandardTasks, visibility, owner } = fields;
            actions.addProject(city.id, name, summary, withStandardTasks,
              showProjectVisibility ? { visibility, owner } : {});
            setShowModal(false);
          }}
          onClose={() => setShowModal(false)}
        />
      )}
      {editProj && (
        <window.ProjectModal
          project={editProj}
          currentUserEmail={userEmail}
          showVisibility={showProjectVisibility}
          onSave={(fields) => {
            actions.updateProject(city.id, editProj.id, projectFields(fields));
            setEditProj(null);
          }}
          onClose={() => setEditProj(null)}
        />
      )}
      {confirmDel && (
        <window.ConfirmModal
          title="מחיקת פרויקט"
          message={`למחוק את "${confirmDel.name}"?`}
          confirmLabel="מחק"
          onConfirm={() => actions.deleteProject(city.id, confirmDel.id)}
          onClose={() => setConfirmDel(null)}
        />
      )}
    </>
  );
}

// ───────────────────────────────────────────────────────────
// TASK ROW
// ───────────────────────────────────────────────────────────
function TaskRow({ task, city, project, actions, dragState, dragHandlers, onEdit }) {
  const [expanded, setExpanded] = vUseState(false);
  const status = window.TM.STATUS_BY_KEY[task.status] || window.TM.STATUSES[0];
  const prio = window.TM.PRIORITY_BY_KEY[task.priority] || window.TM.PRIORITIES[1];
  const calHref = window.TM.calendarUrl(task, project.name, city.name);
  const daysUntil = window.TM.daysUntil(task.due);
  const emails = task.emails || [];

  const dueDisplay = task.due
    ? (
      <div className={"due-stack " + (
        daysUntil !== null && daysUntil < 0 && task.status !== "done" ? "is-overdue " :
        daysUntil !== null && daysUntil <= 3 && task.status !== "done" ? "is-soon " : ""
      )}>
        <span className="due-date">{window.TM.formatHeDate(task.due)}</span>
        {task.time && <span className="due-time" dir="ltr">{task.time}</span>}
      </div>
    )
    : <span className="task-meta muted">—</span>;

  const setStatus = (next, anchor) => {
    if (next === "done" && task.status !== "done") window.celebrateDone(anchor, task, project);
    actions.updateTask(city.id, project.id, task.id, { status: next });
  };
  const cycleStatus = (e) => {
    const order = ["todo", "doing", "done"];
    const cur = order.indexOf(task.status);
    setStatus(order[(cur + 1) % order.length], e.currentTarget);
  };

  return (
    <>
      <div
        className={"task-row "
          + (task.status === "done" ? "is-done " : "")
          + (dragState.isDragging ? "is-dragging " : "")
          + (dragState.isOverAbove ? "drop-above " : "")
          + (dragState.isOverBelow ? "drop-below " : "")}
        {...dragHandlers}
      >
        <span className="task-handle" title="גרור לסידור">{window.Icon.grip}</span>

        <div className="task-title-cell">
          <button
            className={"task-check "
              + (task.status === "done" ? "is-done" : task.status === "doing" ? "is-doing" : "")}
            onClick={cycleStatus}
            title={"שנה סטטוס: " + status.label}
          >
            {task.status === "done" && window.Icon.check}
          </button>
          <span
            className="task-title"
            title={task.title}
            onClick={() => setExpanded(v => !v)}
            style={{ cursor: "pointer" }}
          >{task.title}</span>
          <TaskBadges task={task} project={project} onShowAll={() => setExpanded(true)} />
        </div>

        <div className="task-status-cell">
          <select
            value={task.status}
            onChange={(e) => setStatus(e.target.value, e.target)}
            className={"pill " + status.pill}
            style={{ border: "0", paddingInline: 10, height: 24, fontWeight: 500 }}
          >
            {window.TM.STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </div>

        <div className="task-due-cell">{dueDisplay}</div>

        <div className="task-assignee-cell">
          {task.assignee
            ? <span className="task-meta">{task.assignee}</span>
            : <span className="task-meta muted">לא הוקצה</span>}
        </div>

        <div className="task-prio-cell">
          <span className={"prio-tag " + prio.cls}>{prio.label}</span>
        </div>

        <div className="row-actions">
          {calHref && (
            <a className="task-cal" href={calHref} target="_blank" rel="noopener noreferrer"
              title="הוסף ליומן Google" onClick={(e) => e.stopPropagation()}>
              {window.Icon.cal}
            </a>
          )}
          <button className="btn btn-ghost btn-icon" title="עריכה" onClick={onEdit}>
            {window.Icon.edit}
          </button>
        </div>
      </div>
      {expanded && (task.notes || task.recur || emails.length > 0) && (
        <div className="task-notes-row">
          {task.recur && (
            <div className="task-detail">
              {window.Icon.repeat}
              <span>
                {window.TM.recurLabel(task.recur)}
                {task.lastDone && <> · הושלמה לאחרונה {window.TM.formatHeDate(task.lastDone)}</>}
              </span>
            </div>
          )}
          {emails.map((e, i) => (
            <a key={i} className="task-detail is-link" href={e.url} target="_blank" rel="noopener noreferrer">
              {window.Icon.mail}<span>{e.title}</span>
            </a>
          ))}
          {task.notes && <div className="task-notes-text">{task.notes}</div>}
        </div>
      )}
    </>
  );
}

// ───────────────────────────────────────────────────────────
// PROJECT VIEW
// ───────────────────────────────────────────────────────────
function ProjectView({ data, actions, search, cityId, projectId, userEmail }) {
  const [city, project] = window.findProject(data, cityId, projectId);
  const [editTask, setEditTask] = vUseState(null);
  const [showAdd, setShowAdd] = vUseState(false);
  const [editProj, setEditProj] = vUseState(false);
  const [filterStatus, setFilterStatus] = vUseState("all");
  const [filterAssignee, setFilterAssignee] = vUseState("all");
  const [localSearch, setLocalSearch] = vUseState("");
  const [view, setViewState] = vUseState(() => {
    try { return localStorage.getItem("tm_project_view") || "list"; } catch (e) { return "list"; }
  });
  const setView = (v) => {
    setViewState(v);
    try { localStorage.setItem("tm_project_view", v); } catch (e) {}
  };

  if (!city || !project) return <NoAccess title="פרויקט לא נמצא" />;
  const area = window.areaOf(data, city);
  // Block access if anything up the chain is someone else's private item
  const canSee = window.TM.canSee;
  if (!canSee(area, userEmail) || !canSee(city, userEmail) || !canSee(project, userEmail))
    return <NoAccess title="אין גישה" text="פרויקט זה פרטי למשתמש אחר." />;
  const showProjectVisibility = !!userEmail
    && area.visibility !== "private" && city.visibility !== "private";

  const drag = window.useDragList((from, to) =>
    actions.reorderTasks(city.id, project.id, from, to));
  const cityColor = window.TM.areaColorFor(city.id);

  // assignees list
  const assignees = vUseMemo(() => {
    const s = new Set();
    project.tasks.forEach(t => t.assignee && s.add(t.assignee));
    return Array.from(s).sort();
  }, [project.tasks]);

  // filtered list (preserve real indexes for drag)
  const visibleIndexes = vUseMemo(() => {
    const q = (localSearch || search || "").toLowerCase();
    const result = [];
    project.tasks.forEach((t, idx) => {
      if (filterStatus !== "all" && t.status !== filterStatus) return;
      if (filterAssignee !== "all" && t.assignee !== filterAssignee) return;
      if (q && !(t.title.toLowerCase().includes(q) ||
                 (t.assignee || "").toLowerCase().includes(q) ||
                 (t.notes || "").toLowerCase().includes(q) ||
                 (t.emails || []).some(e => e.title.toLowerCase().includes(q)))) return;
      result.push(idx);
    });
    return result;
  }, [project.tasks, filterStatus, filterAssignee, localSearch, search]);

  const pct = window.TM.tasksProgress(project.tasks);
  const counts = project.tasks.reduce((a, t) => { a[t.status]++; return a; },
    { todo: 0, doing: 0, done: 0 });

  return (
    <>
      <Crumbs items={[
        { label: "סקירה", href: "/" },
        { label: area.name, href: "/area/" + area.id },
        { label: city.name, href: "/city/" + city.id },
        { label: project.name },
      ]} />
      <div className="page-head" style={{ "--hero": cityColor.bar }}>
        <div>
          <span className="area-pill"
            style={{ "--area-color": cityColor.bar, "--area-soft": cityColor.soft, "--area-ink": cityColor.ink }}>
            {city.name}
          </span>
          {project.visibility === "private" && (
            <span className="area-pill"
              style={{ marginInlineStart: 6, "--area-color": cityColor.bar, "--area-soft": cityColor.soft, "--area-ink": cityColor.ink }}>
              {window.Icon.lock}<span>פרויקט פרטי</span>
            </span>
          )}
          <h1 className="page-title">{project.name}</h1>
          {project.summary && <p className="page-sub">{project.summary}</p>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={() => setEditProj(true)}>
            {window.Icon.edit}<span>עריכה</span>
          </button>
          {project.tasks.length === 0 && (
            <button className="btn" onClick={() => actions.addStandardTasks(city.id, project.id)}>
              {window.Icon.plus}<span>הוסף 10 משימות סטנדרטיות</span>
            </button>
          )}
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
            {window.Icon.plus}<span>הוסף משימה</span>
          </button>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi k-progress">
          <div className="kpi-label">התקדמות</div>
          <div className="kpi-value">{pct}%</div>
          <div className="kpi-sub" style={{ marginTop: 10 }}>
            <window.Progress value={pct} showPct={false} />
          </div>
        </div>
        <div className="kpi k-todo">
          <div className="kpi-label">לא התחילו</div>
          <div className="kpi-value">{counts.todo}</div>
        </div>
        <div className="kpi k-doing">
          <div className="kpi-label">בתהליך</div>
          <div className="kpi-value">{counts.doing}</div>
        </div>
        <div className="kpi k-done">
          <div className="kpi-label">הושלמו</div>
          <div className="kpi-value">{counts.done}</div>
        </div>
      </div>

      <div className="toolbar">
        <div className="seg" role="tablist">
          <button type="button" role="tab" aria-selected={view === "list"}
            className={view === "list" ? "is-active" : ""} onClick={() => setView("list")}>
            {window.Icon.list}<span>רשימה</span>
          </button>
          <button type="button" role="tab" aria-selected={view === "map"}
            className={view === "map" ? "is-active" : ""} onClick={() => setView("map")}>
            {window.Icon.flow}<span>מפת משימות</span>
          </button>
        </div>
        {view === "list" && <>
        <input
          className="search-input"
          placeholder="חיפוש במשימות…"
          value={localSearch}
          onChange={(e) => setLocalSearch(e.target.value)}
        />
        <select className="filter-select" value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="all">כל הסטטוסים</option>
          {window.TM.STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <select className="filter-select" value={filterAssignee}
          onChange={(e) => setFilterAssignee(e.target.value)}>
          <option value="all">כל האחראים</option>
          {assignees.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <div className="toolbar-spacer" />
        <span style={{ color: "var(--ink-3)", fontSize: 13 }}>
          {visibleIndexes.length} מתוך {project.tasks.length}
        </span>
        </>}
      </div>

      {view === "map" ? (
        <window.TaskMap project={project} city={city} actions={actions} onEdit={setEditTask} />
      ) : (
      <div className="tasks">
        {project.tasks.length === 0 ? (
          <div className="tasks-empty">
            אין משימות עדיין. הוסף משימה ידנית או טען את 10 המשימות הסטנדרטיות.
          </div>
        ) : visibleIndexes.length === 0 ? (
          <div className="tasks-empty">לא נמצאו משימות התואמות לסינון.</div>
        ) : (
          visibleIndexes.map(idx => {
            const task = project.tasks[idx];
            return (
              <TaskRow
                key={task.id}
                task={task}
                city={city}
                project={project}
                actions={actions}
                dragState={drag.stateFor(idx)}
                dragHandlers={drag.handlers(idx)}
                onEdit={() => setEditTask(task)}
              />
            );
          })
        )}
      </div>
      )}

      {showAdd && (
        <window.TaskModal
          projectTasks={project.tasks}
          onSave={(fields) => {
            actions.addTask(city.id, project.id, fields);
            setShowAdd(false);
          }}
          onClose={() => setShowAdd(false)}
        />
      )}
      {editTask && (
        <window.TaskModal
          task={editTask}
          projectTasks={project.tasks}
          onSave={(fields) => {
            if (fields.status === "done" && editTask.status !== "done")
              window.celebrateDone(null, { ...editTask, ...fields }, project);
            actions.updateTask(city.id, project.id, editTask.id, fields);
            setEditTask(null);
          }}
          onDelete={() => actions.deleteTask(city.id, project.id, editTask.id)}
          onClose={() => setEditTask(null)}
        />
      )}
      {editProj && (
        <window.ProjectModal
          project={project}
          currentUserEmail={userEmail}
          showVisibility={showProjectVisibility}
          onSave={({ name, summary, visibility, owner }) => {
            actions.updateProject(city.id, project.id,
              showProjectVisibility ? { name, summary, visibility, owner } : { name, summary });
            setEditProj(false);
          }}
          onClose={() => setEditProj(false)}
        />
      )}
    </>
  );
}

Object.assign(window, { TopBar, Crumbs, TaskBoard, TaskCard, DashboardView, AreaView, CityView, ProjectView });
