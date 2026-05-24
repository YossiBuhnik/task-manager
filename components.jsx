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
  users:   <svg className="ico" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M14.5 14.5c1-.3 1.8-.5 2.5-.5 2.8 0 5 2.2 5 5"/></svg>,
};

// ─── Progress bar ───────────────────────────────────────────
function Progress({ value, showPct = true, size }) {
  const v = Math.max(0, Math.min(100, value || 0));
  return (
    <div className={"progress-row " + (size === "lg" ? "progress-lg" : "")}>
      <div className="progress"><div className="progress-fill" style={{ width: v + "%" }} /></div>
      {showPct && <span className="progress-pct">{v}%</span>}
    </div>
  );
}

// ─── Status pill (read-only) ────────────────────────────────
function StatusPill({ status }) {
  const s = window.TM.STATUS_BY_KEY[status] || window.TM.STATUSES[0];
  return <span className={"pill " + s.pill}>{s.label}</span>;
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

// ─── City modal (add / edit) ────────────────────────────────
function CityModal({ city, onSave, onClose, currentUserEmail, showVisibility }) {
  const [name, setName] = useState(city?.name || "");
  const [visibility, setVisibility] = useState(city?.visibility || "shared");
  const submit = () => {
    const n = name.trim();
    if (!n) return;
    const owner = visibility === "private"
      ? (city?.owner || currentUserEmail || null)
      : null;
    onSave({ name: n, visibility, owner });
  };
  return (
    <Modal
      title={city ? "עריכת תחום" : "הוספת תחום"}
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
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="לדוגמה: משימות משרד, רעננה, חיפה"
        />
      </div>
      {showVisibility && (
        <div className="field">
          <label>נראות</label>
          <div className="vis-radio">
            <button type="button"
              className={"vis-opt " + (visibility === "shared" ? "is-active" : "")}
              onClick={() => setVisibility("shared")}>
              {Icon.users}<span>משותף עם הצוות</span>
            </button>
            <button type="button"
              className={"vis-opt " + (visibility === "private" ? "is-active" : "")}
              onClick={() => setVisibility("private")}>
              {Icon.lock}<span>פרטי (רק אני)</span>
            </button>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 6, lineHeight: 1.5 }}>
            {visibility === "shared"
              ? "כל חברי הצוות יראו ויוכלו לערוך את התחום הזה."
              : "התחום יוצג רק לך. ניתן להפוך למשותף בכל עת."}
          </div>
        </div>
      )}
    </Modal>
  );
}

// ─── Project modal ──────────────────────────────────────────
function ProjectModal({ project, onSave, onClose, allowStandardTasks }) {
  const [name, setName] = useState(project?.name || "");
  const [summary, setSummary] = useState(project?.summary || "");
  const [withStd, setWithStd] = useState(allowStandardTasks);
  const submit = () => {
    const n = name.trim();
    if (!n) return;
    onSave({ name: n, summary: summary.trim(), withStandardTasks: withStd });
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
    </Modal>
  );
}

// ─── Task modal ─────────────────────────────────────────────
function TaskModal({ task, onSave, onClose, onDelete }) {
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
  });
  const set = (k, v) => setT(prev => ({ ...prev, [k]: v }));
  const submit = () => {
    if (!t.title.trim()) return;
    onSave({ ...t, title: t.title.trim(), participants: t.participants.trim() });
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
          <input type="date" value={t.due} onChange={(e) => set("due", e.target.value)} />
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
  Icon, Progress, StatusPill, CollapseToggle,
  Modal, CityModal, ProjectModal, TaskModal, ConfirmModal,
  useDragList,
});
