// components.jsx — shared components used across views
// (icons, progress bar, status pill, modals, task row, drag-drop helpers)
// Depends on React + data.js (window.TM).

const { useState, useEffect, useRef, useCallback } = React;

// ─── tiny stroke icons (no emoji) ───────────────────────────
const Icon = {
  plus:    <svg className="ico" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>,
  search:  <svg className="ico" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>,
  chevron: <svg className="ico" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>,
  more:    <svg className="ico" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>,
  trash:   <svg className="ico" viewBox="0 0 24 24"><path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M6 7l1 13a1 1 0 001 1h8a1 1 0 001-1l1-13"/></svg>,
  edit:    <svg className="ico" viewBox="0 0 24 24"><path d="M4 20h4l11-11a2 2 0 00-2.8-2.8L5.2 17.2 4 20z"/></svg>,
  cal:     <svg className="ico" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></svg>,
  grip:    <svg className="ico" viewBox="0 0 24 24"><circle cx="9"  cy="6"  r="1.2"/><circle cx="15" cy="6"  r="1.2"/><circle cx="9"  cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9"  cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/></svg>,
  check:   <svg className="ico" viewBox="0 0 24 24" style={{ width: 12, height: 12 }}><path d="M5 12l5 5L20 7"/></svg>,
  download:<svg className="ico" viewBox="0 0 24 24"><path d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16"/></svg>,
  upload:  <svg className="ico" viewBox="0 0 24 24"><path d="M12 20V8m0 0l-4 4m4-4l4 4M4 4h16"/></svg>,
  refresh: <svg className="ico" viewBox="0 0 24 24"><path d="M3 12a9 9 0 0115.5-6.3M21 12a9 9 0 01-15.5 6.3M16 5h5V0M8 19H3v5"/></svg>,
  lock:    <svg className="ico" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>,
  repeat:  <svg className="ico" viewBox="0 0 24 24"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 013-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 01-3 3H3"/></svg>,
  mail:    <svg className="ico" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>,
  list:    <svg className="ico" viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></svg>,
  flow:    <svg className="ico" viewBox="0 0 24 24"><rect x="15" y="3" width="6" height="6" rx="1.5"/><rect x="3" y="15" width="6" height="6" rx="1.5"/><rect x="3" y="3" width="6" height="6" rx="1.5"/><path d="M15 6H9M18 9v3a3 3 0 01-3 3H9"/></svg>,
  x:       <svg className="ico" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>,
  users:   <svg className="ico" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M14.5 14.5c1-.3 1.8-.5 2.5-.5 2.8 0 5 2.2 5 5"/></svg>,
};

// ─── Progress bar ───────────────────────────────────────────
// Color follows how far along it is (orange → blue → green); at 100% it turns
// into a "complete" bar. Inside area cards the area color wins (see CSS).
const progressTier = (v) => v >= 100 ? "is-complete" : v >= 67 ? "is-high" : v >= 34 ? "is-mid" : "is-low";
const reducedMotion = () => !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

// Counts a number up to `target` (and from the old value when it changes).
function useCountUp(target, ms = 900) {
  const [shown, setShown] = useState(reducedMotion() ? target : 0);
  const cur = useRef(shown);
  useEffect(() => {
    if (reducedMotion()) { cur.current = target; setShown(target); return; }
    const from = cur.current, start = performance.now();
    let raf;
    const tick = (now) => {
      const k = Math.min(1, (now - start) / ms);
      cur.current = Math.round(from + (target - from) * (1 - Math.pow(1 - k, 3)));
      setShown(cur.current);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return shown;
}

// The percentage sits inside the bar; when the fill is too short for it, just past its end.
function Progress({ value, showPct = true, size }) {
  const v = Math.max(0, Math.min(100, value || 0));
  const shown = useCountUp(v);
  const inside = v >= 20;
  const label = <>{v === 100 && Icon.check}{shown}%</>;
  return (
    <div className={"progress-row " + progressTier(v) + (size === "lg" ? " progress-lg" : "") + (showPct ? " has-label" : "")}>
      <div className="progress" role="progressbar" aria-valuenow={v} aria-valuemin="0" aria-valuemax="100">
        <div className="progress-fill" style={{ width: v + "%" }}>
          {showPct && inside && <span className="progress-label">{label}</span>}
        </div>
        {showPct && !inside && (
          <span className="progress-label is-outside" style={{ insetInlineStart: `calc(${v}% + 6px)` }}>{label}</span>
        )}
      </div>
    </div>
  );
}

// ─── Completion feedback: confetti burst + toast ────────────
// Plain DOM outside React, so re-renders (and the task leaving the list) don't cut it short.
const FX_COLORS = ["#2563eb", "#22c55e", "#f59e0b", "#ec4899", "#8b5cf6", "#14b8a6", "#f97316"];
const CHEERS = ["כל הכבוד!", "יפה מאוד!", "עוד אחת מאחוריך", "ממשיכים בתנופה!", "מעולה!", "סגרת עוד משימה"];
function confettiBurst(x, y, { count = 18, spread = 70 } = {}) {
  if (reducedMotion()) return;
  const layer = document.createElement("div");
  layer.className = "fx-layer";
  layer.style.left = x + "px";
  layer.style.top = y + "px";
  const ring = document.createElement("span");
  ring.className = "fx-ring";
  layer.appendChild(ring);
  for (let i = 0; i < count; i++) {
    const bit = document.createElement("span");
    bit.className = "fx-bit" + (i % 3 === 0 ? " is-round" : "");
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
    const dist = spread * (0.55 + Math.random() * 0.6);
    bit.style.setProperty("--dx", Math.cos(angle) * dist + "px");
    bit.style.setProperty("--dy", Math.sin(angle) * dist - spread * 0.35 + "px");
    bit.style.setProperty("--rot", Math.round(Math.random() * 540 - 270) + "deg");
    bit.style.background = FX_COLORS[i % FX_COLORS.length];
    layer.appendChild(bit);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 1200);
}

const TOAST_ICON = {
  check: '<path d="M5 12l5 5L20 7"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
};

function toast(title, sub, { big = false, info = false } = {}) {
  let host = document.querySelector(".toast-host");
  if (!host) {
    host = document.createElement("div");
    host.className = "toast-host";
    host.setAttribute("role", "status");
    document.body.appendChild(host);
  }
  while (host.children.length >= 3) host.firstChild.remove();
  const el = document.createElement("div");
  el.className = "toast" + (big ? " is-big" : "") + (info ? " is-info" : "");
  el.innerHTML = '<span class="toast-icon"><svg class="ico" viewBox="0 0 24 24">' + TOAST_ICON[info ? "lock" : "check"] + '</svg></span>'
    + '<span class="toast-body"><strong></strong><span></span></span>';
  el.querySelector("strong").textContent = title;          // user text → textContent only
  el.querySelector(".toast-body span").textContent = sub || "";
  host.appendChild(el);
  setTimeout(() => el.classList.add("is-leaving"), big ? 3600 : 2600);
  setTimeout(() => el.remove(), big ? 4000 : 3000);
}

// Call just before a task is marked done. `anchor` is the clicked element (the
// burst starts there); a project whose last open task this was gets the big one.
function celebrateDone(anchor, task, project) {
  const r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
  const x = r ? r.left + r.width / 2 : window.innerWidth / 2;
  const y = r ? r.top + r.height / 2 : window.innerHeight / 2;
  const projectDone = project && !task.recur
    && project.tasks.every(t => t.id === task.id || t.status === "done");
  confettiBurst(x, y);
  if (projectDone) {
    [0.2, 0.5, 0.8].forEach((fx, i) => setTimeout(() =>
      confettiBurst(window.innerWidth * fx, window.innerHeight * 0.3, { count: 30, spread: 150 }), 150 + i * 160));
    toast(`הפרויקט "${project.name}" הושלם!`, "כל המשימות סומנו כהושלמו — כל הכבוד", { big: true });
    return;
  }
  const sub = task.recur
    ? "חוזרת · המועד הבא: " + window.TM.formatHeDate(window.TM.nextRecurDue(task.recur, task.due))
    : task.title;
  toast(CHEERS[Math.floor(Math.random() * CHEERS.length)], sub);
}

// ─── Status pill (read-only) ────────────────────────────────
function StatusPill({ status }) {
  const s = window.TM.STATUS_BY_KEY[status] || window.TM.STATUSES[0];
  return <span className={"pill " + s.pill}>{s.label}</span>;
}

// ─── App logo glyph (progress ring + check, same as icons/*.png) ──
function BrandGlyph() {
  return (
    <svg viewBox="0 0 512 512" aria-hidden="true">
      <circle cx="256" cy="256" r="150" fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="48" />
      <circle cx="256" cy="256" r="150" fill="none" stroke="currentColor" strokeWidth="48" strokeLinecap="round"
        strokeDasharray="660 943" transform="rotate(-90 256 256)" />
      <path d="M196 262l42 42 82-92" fill="none" stroke="currentColor" strokeWidth="48" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Collapse toggle ────────────────────────────────────────
function CollapseToggle({ collapsed, onToggle }) {
  return (
    <button
      className={"collapse-btn " + (collapsed ? "is-collapsed" : "")}
      onClick={onToggle}
      aria-label={collapsed ? "פתח" : "סגור"}
    >{Icon.chevron}</button>
  );
}

// ─── Modal shell ────────────────────────────────────────────
function Modal({ title, onClose, children, footer }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true">
        <h3>{title}</h3>
        {children}
        {footer && <div className="modal-actions">{footer}</div>}
      </div>
    </div>
  );
}

// ─── Area (תחום) modal (add / edit) ─────────────────────────
function AreaModal({ area, onSave, onClose, currentUserEmail, showVisibility }) {
  const [name, setName] = useState(area?.name || "");
  const [visibility, setVisibility] = useState(area?.visibility || "shared");
  const submit = () => {
    const n = name.trim();
    if (!n) return;
    const owner = visibility === "private" ? (area?.owner || currentUserEmail || null) : null;
    onSave({ name: n, visibility, owner });
  };
  return (
    <Modal
      title={area ? "עריכת תחום" : "הוספת תחום"}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={submit}>שמירה</button>
          <button className="btn" onClick={onClose}>ביטול</button>
        </>
      }
    >
      <div className="field">
        <label>שם התחום</label>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="לדוגמה: משרד, ניהול פרויקטים, הבטחת איכות" />
      </div>
      {showVisibility && (
        <VisibilityPicker value={visibility} onChange={setVisibility} noun="התחום" />
      )}
    </Modal>
  );
}

// ─── Client (מזמין עבודה) modal (add / edit) ───────────────
// Stored as a "city" for historic reasons. showVisibility is false when the
// chosen area is private (the client inherits it).
function CityModal({ city, areas, defaultAreaId, onSave, onClose, currentUserEmail, userEmail }) {
  const [name, setName] = useState(city?.name || "");
  // Editing an unassigned client keeps it unassigned until an area is picked.
  const [areaId, setAreaId] = useState(() => {
    if (city) return areas.some(a => a.id === city.areaId) ? city.areaId : "";
    return defaultAreaId || areas[0]?.id || "";
  });
  const [visibility, setVisibility] = useState(city?.visibility || "shared");
  const area = areas.find(a => a.id === areaId);
  const showVisibility = !!userEmail && area?.visibility !== "private";
  const submit = () => {
    const n = name.trim();
    if (!n) return;
    const fields = { name: n, areaId: areaId || null };
    if (showVisibility) {
      fields.visibility = visibility;
      fields.owner = visibility === "private" ? (city?.owner || currentUserEmail || null) : null;
    }
    onSave(fields);
  };
  return (
    <Modal
      title={city ? "עריכת מזמין עבודה" : "הוספת מזמין עבודה"}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={submit}>שמירה</button>
          <button className="btn" onClick={onClose}>ביטול</button>
        </>
      }
    >
      <div className="field">
        <label>שם מזמין העבודה</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="לדוגמה: עיריית תל אביב, חברה כלכלית אשדוד"
        />
      </div>
      <div className="field">
        <label>תחום</label>
        <select value={areaId} onChange={(e) => setAreaId(e.target.value)}>
          {!areaId && <option value="">— בחר תחום —</option>}
          {areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
      {showVisibility && (
        <VisibilityPicker value={visibility} onChange={setVisibility} noun="מזמין העבודה" />
      )}
    </Modal>
  );
}

// ─── Visibility picker (shared / private) ───────────────────
function VisibilityPicker({ value, onChange, noun }) {
  return (
    <div className="field">
      <label>נראות</label>
      <div className="vis-radio">
        <button type="button"
          className={"vis-opt " + (value === "shared" ? "is-active" : "")}
          onClick={() => onChange("shared")}>
          {Icon.users}<span>משותף עם הצוות</span>
        </button>
        <button type="button"
          className={"vis-opt " + (value === "private" ? "is-active" : "")}
          onClick={() => onChange("private")}>
          {Icon.lock}<span>פרטי (רק אני)</span>
        </button>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 6, lineHeight: 1.5 }}>
        {value === "shared"
          ? `כל חברי הצוות יראו ויוכלו לערוך את ${noun} הזה.`
          : `${noun} יוצג רק לך. ניתן להפוך למשותף בכל עת.`}
      </div>
    </div>
  );
}

// ─── Project modal ──────────────────────────────────────────
// showVisibility is false when the parent תחום is already private
// (the project then inherits it — nobody else can see it anyway).
function ProjectModal({ project, onSave, onClose, allowStandardTasks, currentUserEmail, showVisibility }) {
  const [name, setName] = useState(project?.name || "");
  const [summary, setSummary] = useState(project?.summary || "");
  const [withStd, setWithStd] = useState(allowStandardTasks);
  const [visibility, setVisibility] = useState(project?.visibility || "shared");
  const submit = () => {
    const n = name.trim();
    if (!n) return;
    const fields = { name: n, summary: summary.trim(), withStandardTasks: withStd };
    if (showVisibility) {
      fields.visibility = visibility;
      fields.owner = visibility === "private"
        ? (project?.owner || currentUserEmail || null)
        : null;
    }
    onSave(fields);
  };
  return (
    <Modal
      title={project ? "עריכת פרויקט" : "הוספת פרויקט"}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={submit}>שמירה</button>
          <button className="btn" onClick={onClose}>ביטול</button>
        </>
      }
    >
      <div className="field">
        <label>שם הפרויקט</label>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
          placeholder="לדוגמה: שדרוג שדרות ויצמן" />
      </div>
      <div className="field">
        <label>תיאור קצר (אופציונלי)</label>
        <textarea value={summary} onChange={(e) => setSummary(e.target.value)}
          placeholder="הקשר, שלב, או הערה כללית" />
      </div>
      {allowStandardTasks && (
        <div className="field" style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <input type="checkbox" id="withstd" checked={withStd}
            onChange={(e) => setWithStd(e.target.checked)} style={{ width: 16, height: 16 }} />
          <label htmlFor="withstd" style={{ color: "var(--ink-2)", fontWeight: 500 }}>
            הוסף את 10 המשימות הסטנדרטיות לפרויקט
          </label>
        </div>
      )}
      {showVisibility && (
        <VisibilityPicker value={visibility} onChange={setVisibility} noun="הפרויקט" />
      )}
    </Modal>
  );
}

// ─── Recurrence picker (inside the task modal) ──────────────
const RECUR_UNITS = { day: "ימים", week: "שבועות", month: "חודשים", year: "שנים" };

function RecurField({ recur, due, onChange }) {
  const TM = window.TM;
  // Turning repetition on: take weekday / day of month from the due date (or today).
  const setFreq = (freq) => {
    if (!freq) return onChange(null, due);
    const base = due || TM.toDateInput(new Date());
    const rule = TM.recurFromDue({ freq, interval: 1, weekday: 0, month: 0, monthDay: 1 }, base);
    onChange(rule, base);
  };
  // Changing which day it falls on moves the due date to the next such day.
  const setDay = (fields) => {
    const rule = { ...recur, ...fields };
    onChange(rule, TM.firstRecurDue(rule));
  };
  const setInterval = (v) => {
    const n = Math.max(1, Math.min(99, parseInt(v, 10) || 1));
    onChange({ ...recur, interval: n }, due);
  };
  const days = Array.from({ length: 31 }, (_, i) => i + 1);

  return (
    <div className="field">
      <label>חזרה</label>
      <div className="recur-row">
        <select value={recur?.freq || ""} onChange={(e) => setFreq(e.target.value)}>
          <option value="">לא חוזרת</option>
          <option value="day">יומית</option>
          <option value="week">שבועית</option>
          <option value="month">חודשית</option>
          <option value="year">שנתית</option>
        </select>
        {recur && (
          <>
            <span className="recur-word">כל</span>
            <input type="number" min="1" max="99" className="recur-num" value={recur.interval}
              onChange={(e) => setInterval(e.target.value)} />
            <span className="recur-word">{RECUR_UNITS[recur.freq]}</span>
          </>
        )}
        {recur?.freq === "week" && (
          <select value={recur.weekday} onChange={(e) => setDay({ weekday: Number(e.target.value) })}>
            {TM.WEEKDAYS.map((d, i) => <option key={i} value={i}>ביום {d}</option>)}
          </select>
        )}
        {recur?.freq === "year" && (
          <select value={recur.month} onChange={(e) => setDay({ month: Number(e.target.value) })}>
            {TM.MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
          </select>
        )}
        {(recur?.freq === "month" || recur?.freq === "year") && (
          <select value={recur.monthDay} onChange={(e) => setDay({ monthDay: Number(e.target.value) })}>
            {days.map(d => <option key={d} value={d}>ב-{d}</option>)}
            <option value={-1}>ביום האחרון</option>
          </select>
        )}
      </div>
      {recur && (
        <div className="field-hint">
          {TM.recurLabel(recur)}
          {due && <> · תאריך היעד: {TM.formatHeDate(due)}</>}
          {" · "}כשמסמנים "הושלם", המשימה עוברת למועד הבא
        </div>
      )}
    </div>
  );
}

// ─── Email-thread links (inside the task modal) ─────────────
const isUrl = (s) => /^https?:\/\/\S+$/i.test(s.trim());

function EmailLinksField({ emails, onChange, draft, onDraftChange, error }) {
  const remove = (i) => onChange(emails.filter((_, j) => j !== i));
  return (
    <div className="field">
      <label>שרשורי מייל <span style={{ color: "var(--ink-3)", fontWeight: 400 }}>(פותחים את השרשור ב-Gmail ומעתיקים את הכתובת מהדפדפן)</span></label>
      {emails.map((e, i) => (
        <div key={i} className="email-chip">
          {Icon.mail}
          <a href={e.url} target="_blank" rel="noopener noreferrer">{e.title}</a>
          <button type="button" className="btn btn-ghost btn-icon" title="הסר קישור" onClick={() => remove(i)}>{Icon.x}</button>
        </div>
      ))}
      <div className="email-add">
        <input dir="ltr" value={draft.url} placeholder="https://mail.google.com/mail/u/0/#inbox/…"
          onChange={(e) => onDraftChange({ ...draft, url: e.target.value })} />
        <input value={draft.title} placeholder="נושא (אופציונלי)"
          onChange={(e) => onDraftChange({ ...draft, title: e.target.value })} />
      </div>
      {error && <div className="field-error">{error}</div>}
    </div>
  );
}

// ─── Prerequisites picker (inside the task modal) ───────────
// Only tasks of the same project; ones that would create a loop aren't offered.
function DependsField({ taskId, tasks, value, onChange }) {
  const TM = window.TM;
  const byId = new Map(tasks.map(t => [t.id, t]));
  const chosen = value.filter(id => byId.has(id));
  const options = tasks.filter(t => t.id !== taskId && !chosen.includes(t.id)
    && !(taskId && TM.wouldCycle(tasks, taskId, t.id)));
  if (!chosen.length && !options.length) return null;
  return (
    <div className="field">
      <label>תלויה במשימות <span style={{ color: "var(--ink-3)", fontWeight: 400 }}>(מה צריך להסתיים לפני שאפשר להתחיל)</span></label>
      {chosen.length > 0 && (
        <div className="dep-chips">
          {chosen.map(id => {
            const t = byId.get(id);
            return (
              <span key={id} className={"dep-chip" + (t.status === "done" ? " is-done" : "")}>
                {t.status === "done" ? Icon.check : Icon.lock}
                <span>{t.title}</span>
                <button type="button" title="הסר תלות" onClick={() => onChange(chosen.filter(x => x !== id))}>{Icon.x}</button>
              </span>
            );
          })}
        </div>
      )}
      {options.length > 0 && (
        <select value="" onChange={(e) => e.target.value && onChange([...chosen, e.target.value])}>
          <option value="">+ הוסף משימה שצריכה להסתיים קודם…</option>
          {options.map(t => <option key={t.id} value={t.id}>{t.title}{t.status === "done" ? " ✓" : ""}</option>)}
        </select>
      )}
    </div>
  );
}

// ─── Task modal ─────────────────────────────────────────────
function TaskModal({ task, projectTasks = [], onSave, onClose, onDelete }) {
  const [t, setT] = useState({
    title: task?.title || "",
    status: task?.status || "todo",
    due: task?.due || "",
    time: task?.time || "",
    duration: task?.duration ?? 60,
    participants: task?.participants || "",
    assignee: task?.assignee || "",
    priority: task?.priority || "mid",
    notes: task?.notes || "",
    recur: task?.recur || null,
    emails: task?.emails || [],
    dependsOn: task?.dependsOn || [],
  });
  const [emailDraft, setEmailDraft] = useState({ url: "", title: "" });
  const [emailError, setEmailError] = useState("");
  const set = (k, v) => setT(prev => ({ ...prev, [k]: v }));
  // A manual due-date change keeps a recurring rule in step with it.
  const setDue = (due) => setT(prev => ({ ...prev, due, recur: window.TM.recurFromDue(prev.recur, due) }));
  // A link typed but not yet listed is saved too.
  const pendingEmail = () => {
    const url = emailDraft.url.trim();
    if (!url) return null;
    if (!isUrl(url)) { setEmailError("הקישור צריך להתחיל ב-https://"); return false; }
    return { url, title: emailDraft.title.trim() || "שרשור מייל" };
  };
  const addEmail = () => {
    const e = pendingEmail();
    if (!e) return;
    set("emails", [...t.emails, e]);
    setEmailDraft({ url: "", title: "" });
    setEmailError("");
  };
  const submit = () => {
    if (!t.title.trim()) return;
    const e = pendingEmail();
    if (e === false) return;
    onSave({
      ...t,
      title: t.title.trim(),
      participants: t.participants.trim(),
      emails: e ? [...t.emails, e] : t.emails,
    });
  };
  const hasTime = !!t.time;
  return (
    <Modal
      title={task ? "עריכת משימה" : "הוספת משימה"}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={submit}>שמירה</button>
          <button className="btn" onClick={onClose}>ביטול</button>
          {task && onDelete && (
            <>
              <span style={{ flex: 1 }} />
              <button className="btn btn-danger" onClick={() => { onDelete(); onClose(); }}>מחיקה</button>
            </>
          )}
        </>
      }
    >
      <div className="field">
        <label>כותרת</label>
        <input autoFocus value={t.title} onChange={(e) => set("title", e.target.value)} />
      </div>
      <div className="field-row">
        <div className="field">
          <label>סטטוס</label>
          <select value={t.status} onChange={(e) => set("status", e.target.value)}>
            {window.TM.STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label>עדיפות</label>
          <select value={t.priority} onChange={(e) => set("priority", e.target.value)}>
            {window.TM.PRIORITIES.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label>תאריך יעד</label>
          <input type="date" value={t.due} onChange={(e) => setDue(e.target.value)} />
        </div>
        <div className="field">
          <label>שעה <span style={{ color: "var(--ink-3)", fontWeight: 400 }}>(אופציונלי)</span></label>
          <div style={{ display: "flex", gap: 6 }}>
            <input type="time" value={t.time} onChange={(e) => set("time", e.target.value)}
              style={{ flex: 1, padding: "9px 12px", border: "1px solid var(--line)", borderRadius: 8, background: "var(--surface)", outline: "none" }} />
            {t.time && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => set("time", "")}
                title="נקה שעה" style={{ padding: "0 10px" }}>נקה</button>
            )}
          </div>
        </div>
      </div>
      {hasTime && (
        <div className="field">
          <label>משך הפגישה</label>
          <select value={t.duration} onChange={(e) => set("duration", Number(e.target.value))}>
            <option value={15}>15 דקות</option>
            <option value={30}>30 דקות</option>
            <option value={45}>45 דקות</option>
            <option value={60}>שעה</option>
            <option value={90}>שעה וחצי</option>
            <option value={120}>שעתיים</option>
            <option value={180}>3 שעות</option>
            <option value={240}>4 שעות</option>
          </select>
        </div>
      )}
      <RecurField recur={t.recur} due={t.due}
        onChange={(recur, due) => setT(prev => ({ ...prev, recur, due }))} />
      <DependsField taskId={task?.id} tasks={projectTasks} value={t.dependsOn}
        onChange={(v) => set("dependsOn", v)} />
      <div className="field">
        <label>אחראי</label>
        <input value={t.assignee} onChange={(e) => set("assignee", e.target.value)}
          placeholder="לדוגמה: דנה לוי" />
      </div>
      <div className="field">
        <label>משתתפים נוספים <span style={{ color: "var(--ink-3)", fontWeight: 400 }}>(כתובות אימייל מופרדות בפסיק — יצורפו כהזמנה ביומן)</span></label>
        <input value={t.participants} onChange={(e) => set("participants", e.target.value)}
          placeholder="yossi@example.com, dana@example.com" dir="ltr" />
      </div>
      <div className="field">
        <label>הערות</label>
        <textarea value={t.notes} onChange={(e) => set("notes", e.target.value)} />
      </div>
      <EmailLinksField emails={t.emails} onChange={(v) => set("emails", v)}
        draft={emailDraft} error={emailError}
        onDraftChange={(d) => { setEmailDraft(d); setEmailError(""); }} />
      {emailDraft.url.trim() && (
        <button type="button" className="btn btn-sm" style={{ marginTop: -6 }} onClick={addEmail}>
          {Icon.plus}<span>הוסף קישור</span>
        </button>
      )}
    </Modal>
  );
}

// ─── Confirm dialog ────────────────────────────────────────
function ConfirmModal({ title, message, onConfirm, onClose, confirmLabel = "אישור" }) {
  return (
    <Modal title={title} onClose={onClose}
      footer={
        <>
          <button className="btn btn-danger" onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</button>
          <button className="btn" onClick={onClose}>ביטול</button>
        </>
      }
    >
      <p style={{ margin: 0, color: "var(--ink-2)" }}>{message}</p>
    </Modal>
  );
}

// ─── Drag-drop hook (simple HTML5 DnD between siblings) ────
function useDragList(onReorder) {
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);
  const [overSide, setOverSide] = useState(null); // 'above' | 'below'

  const handlers = (idx) => ({
    draggable: true,
    onDragStart: (e) => {
      setDragIdx(idx);
      e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", String(idx)); } catch (_) {}
    },
    onDragOver: (e) => {
      if (dragIdx === null) return;
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      const side = e.clientY < midpoint ? "above" : "below";
      setOverIdx(idx);
      setOverSide(side);
    },
    onDragLeave: () => {},
    onDrop: (e) => {
      e.preventDefault();
      if (dragIdx === null || overIdx === null) { reset(); return; }
      let to = overIdx + (overSide === "below" ? 1 : 0);
      if (dragIdx < to) to -= 1;
      if (to !== dragIdx) onReorder(dragIdx, to);
      reset();
    },
    onDragEnd: () => reset(),
    "data-drag-idx": idx,
  });

  const reset = () => { setDragIdx(null); setOverIdx(null); setOverSide(null); };

  const stateFor = (idx) => ({
    isDragging: dragIdx === idx,
    isOverAbove: overIdx === idx && overSide === "above" && dragIdx !== idx,
    isOverBelow: overIdx === idx && overSide === "below" && dragIdx !== idx,
  });

  return { handlers, stateFor };
}

Object.assign(window, {
  Icon, BrandGlyph, Progress, StatusPill, CollapseToggle, celebrateDone,
  toastInfo: (title, sub) => toast(title, sub, { info: true }),
  Modal, AreaModal, CityModal, VisibilityPicker, ProjectModal, TaskModal, ConfirmModal,
  useDragList,
});
