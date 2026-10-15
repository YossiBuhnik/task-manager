// taskmap.jsx — "מפת משימות": a free canvas of a project's tasks and the links
// between them (node-editor style), flowing top to bottom. Each task has an input
// point (top — what must come before it) and an output point (bottom — what waits on it).
//   • drag from a point to a task (or click a point, then a task) → link
//   • click a line → × to unlink
//   • drag a card to move it; a plain click opens it
//   • drag a task from the tray onto the canvas (and an unlinked one back)
// Positions are saved on the task (task.pos = { x: from the right edge, y }).
// Depends on React, window.TM, window.Icon, window.celebrateDone, window.toastInfo.

const { useState: mUseState, useRef: mUseRef, useMemo: mUseMemo,
        useEffect: mUseEffect, useLayoutEffect: mUseLayoutEffect } = React;

const MAP = { nodeW: 216, colGap: 28, rowGap: 72, pad: 36, estH: { done: 38, other: 108 } };
const STATE_LABEL = { ready: "מוכנה להתחלה", doing: "בתהליך", done: "הושלמה" };

function shortDue(due) {
  const n = window.TM.daysUntil(due);
  if (n === null) return null;
  if (n < 0) return { text: `באיחור ${-n === 1 ? "יום" : -n + " ימים"}`, cls: "is-overdue" };
  if (n === 0) return { text: "היום", cls: "is-soon" };
  if (n === 1) return { text: "מחר", cls: "is-soon" };
  return { text: window.TM.formatHeDate(due), cls: n <= 3 ? "is-soon" : "" };
}

function initials(name) {
  return String(name || "").trim().split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join("");
}

// Stage-by-stage starting positions for linked tasks: one row per stage, first
// stage on top, each row centred (x is measured from the right edge).
function autoPositions(tasks, layout) {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const h = (id) => byId.get(id)?.status === "done" ? MAP.estH.done : MAP.estH.other;
  const slot = MAP.nodeW + MAP.colGap;
  const widest = Math.max(0, ...layout.columns.map(row => row.length));
  const pos = new Map();
  let y = MAP.pad + 8;
  layout.columns.forEach(row => {
    const offset = (widest - row.length) * slot / 2;
    row.forEach((id, i) => pos.set(id, { x: Math.round(MAP.pad + offset + i * slot), y }));
    y += Math.max(...row.map(h)) + MAP.rowGap;
  });
  return pos;
}

// Nudge a new position sideways until it doesn't sit on top of another card.
function freeSpot(p, taken) {
  const hit = (a, b) => Math.abs(a.x - b.x) < MAP.nodeW && Math.abs(a.y - b.y) < MAP.estH.other;
  let q = { ...p };
  for (let i = 0; i < 40 && taken.some(t => hit(t, q)); i++) q = { ...q, x: q.x + MAP.nodeW + MAP.colGap };
  return q;
}
const ROW_STEP = MAP.estH.other + MAP.rowGap;

function MapNode({ task, state, blockers, cls, style, nodeRef, onPointerDown, onHover, onCheck, onPortDown }) {
  const due = state !== "done" ? shortDue(task.due) : null;
  return (
    <div
      ref={nodeRef}
      data-task-id={task.id}
      className={"map-node is-" + state + cls}
      style={style}
      onPointerDown={onPointerDown}
      onMouseEnter={() => onHover(task.id)}
      onMouseLeave={() => onHover(null)}
      title={state === "blocked" ? "ממתינה ל: " + blockers.map(b => b.title).join(", ") : task.title}
    >
      <span className="map-port is-in" title="מה צריך להסתיים קודם — גררו מכאן למשימה"
        onPointerDown={(e) => onPortDown(e, task.id, "in")} />
      <span className="map-port is-out" title="מה מחכה למשימה הזו — גררו מכאן למשימה"
        onPointerDown={(e) => onPortDown(e, task.id, "out")} />
      <button type="button" className="map-check"
        aria-label={state === "blocked" ? "ממתינה למשימות קודמות" : "שנה סטטוס"}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onCheck(task, state, blockers, e.currentTarget); }}>
        {state === "done" ? window.Icon.check : state === "blocked" ? window.Icon.lock : null}
      </button>
      <div className="map-node-body">
        <div className="map-node-title">{task.title}</div>
        {state !== "done" && (
          <div className="map-node-meta">
            {state === "blocked"
              ? <span className="map-tag is-blocked">{window.Icon.lock}ממתינה ל-{blockers.length}</span>
              : <span className={"map-tag is-" + state}>{STATE_LABEL[state]}</span>}
            {due && <span className={"map-due " + due.cls}>{due.text}</span>}
            {task.assignee && <span className="map-avatar" title={task.assignee}>{initials(task.assignee)}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function TaskMap({ project, city, actions, onEdit }) {
  const TM = window.TM;
  const tasks = project.tasks;
  const layout = mUseMemo(() => TM.dependencyLayout(tasks), [tasks]);
  const byId = mUseMemo(() => new Map(tasks.map(t => [t.id, t])), [tasks]);
  const states = mUseMemo(() => new Map(tasks.map(t => [t.id, TM.taskState(t, tasks)])), [tasks]);
  const blockers = mUseMemo(() => new Map(tasks.map(t => [t.id, TM.blockersOf(t, tasks)])), [tasks]);
  const auto = mUseMemo(() => autoPositions(tasks, layout), [tasks, layout]);

  // On the canvas: anything linked or placed; the rest waits in the tray.
  const trayIds = layout.isolated.filter(id => !byId.get(id).pos);
  const canvasIds = tasks.map(t => t.id).filter(id => !trayIds.includes(id));

  const [hover, setHover] = mUseState(null);
  const [paths, setPaths] = mUseState([]);
  const [size, setSize] = mUseState({ w: 0, h: 0 });
  const [dragPos, setDragPos] = mUseState(null);        // { id, x, y } while moving a card
  const [draft, setDraft] = mUseState(null);            // { from, dir, cx, cy } while linking (screen coords)
  const [selEdge, setSelEdge] = mUseState(null);        // "from>to"
  const [unlocked, setUnlocked] = mUseState(() => new Set());
  const boardRef = mUseRef(null);
  const canvasRef = mUseRef(null);
  const nodeEls = mUseRef(new Map());
  const ix = mUseRef(null);                              // current pointer interaction
  const prevStates = mUseRef(states);
  const dragPosRef = mUseRef(null);
  dragPosRef.current = dragPos;
  const revealIds = mUseRef([]);                         // tasks just placed → scroll them into view

  const posOf = (id) => (dragPos && dragPos.id === id) ? dragPos : (byId.get(id)?.pos || auto.get(id));

  // ── persistence ────────────────────────────────────────────
  // Every change freezes all canvas positions, so links never reshuffle the map.
  // `placed[id]` = new position, or null to send a task back to the tray.
  const commit = (mutate = (t) => t, placed = {}) => {
    const next = tasks.map(t => {
      const u = mutate(t);
      const p = placed[t.id] !== undefined ? placed[t.id] : (canvasIds.includes(t.id) ? posOf(t.id) : u.pos);
      if (p === null) { const { pos, ...rest } = u; return rest; }
      return p ? { ...u, pos: { x: Math.round(p.x), y: Math.round(p.y) } } : u;
    });
    actions.updateProject(city.id, project.id, { tasks: next });
  };

  const canLink = (pre, dep) => {
    if (!pre || !dep || pre === dep || !byId.has(pre) || !byId.has(dep)) return false;
    if ((byId.get(dep).dependsOn || []).includes(pre)) return false;
    return !TM.wouldCycle(tasks, dep, pre);
  };
  // Link pre → dep; a task coming from the tray gets a spot next to its partner.
  const link = (pre, dep) => {
    if (!canLink(pre, dep)) return;
    const placed = {};
    const taken = canvasIds.map(posOf).filter(Boolean);
    if (!canvasIds.includes(dep) && posOf(pre)) {          // goes below its prerequisite
      const p = posOf(pre);
      placed[dep] = freeSpot({ x: p.x, y: p.y + ROW_STEP }, taken);
    }
    if (!canvasIds.includes(pre) && posOf(dep)) {          // goes above the task waiting on it
      const p = posOf(dep);
      placed[pre] = freeSpot({ x: p.x, y: Math.max(MAP.pad, p.y - ROW_STEP) }, taken);
    }
    revealIds.current = Object.keys(placed);
    commit(t => t.id === dep ? { ...t, dependsOn: [...(t.dependsOn || []), pre] } : t, placed);
  };
  const unlink = (pre, dep) => {
    commit(t => t.id === dep ? { ...t, dependsOn: (t.dependsOn || []).filter(x => x !== pre) } : t);
    setSelEdge(null);
  };
  const autoArrange = () => {
    const placed = {};
    tasks.forEach(t => { placed[t.id] = auto.get(t.id) || null; });   // unlinked go back to the tray
    commit(t => t, placed);
  };

  // ── unlock glow ────────────────────────────────────────────
  mUseEffect(() => {
    const fresh = new Set();
    states.forEach((st, id) => {
      if (prevStates.current.get(id) === "blocked" && (st === "ready" || st === "doing")) fresh.add(id);
    });
    prevStates.current = states;
    if (!fresh.size) return;
    setUnlocked(fresh);
    const t = setTimeout(() => setUnlocked(new Set()), 1600);
    return () => clearTimeout(t);
  }, [states]);

  // ── hover chain ────────────────────────────────────────────
  const chain = mUseMemo(() => {
    if (!hover || draft || dragPos) return null;
    const set = new Set([hover]);
    const walk = (id, up) => layout.edges.forEach(e => {
      const [a, b] = up ? [e.to, e.from] : [e.from, e.to];
      if (a === id && !set.has(b)) { set.add(b); walk(b, up); }
    });
    walk(hover, true);
    walk(hover, false);
    return set;
  }, [hover, layout, draft, dragPos]);

  // ── lines (measured from the real cards) ───────────────────
  const draw = () => {
    const board = boardRef.current;
    if (!board) return;
    const b = board.getBoundingClientRect();
    const next = [];
    for (const e of layout.edges) {
      const a = nodeEls.current.get(e.from), z = nodeEls.current.get(e.to);
      if (!a || !z || !board.contains(a) || !board.contains(z)) continue;
      const ra = a.getBoundingClientRect(), rz = z.getBoundingClientRect();
      // bottom of the prerequisite → top of the task waiting on it
      const x1 = ra.left + ra.width / 2 - b.left, y1 = ra.bottom - b.top;
      const x2 = rz.left + rz.width / 2 - b.left, y2 = rz.top - b.top;
      const dy = Math.max(36, Math.abs(y2 - y1) * 0.5);
      const d = `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`;
      // midpoint of the curve, for the unlink button
      const mx = 0.5 * x1 + 0.5 * x2;
      const my = 0.125 * y1 + 0.375 * (y1 + dy) + 0.375 * (y2 - dy) + 0.125 * y2;
      next.push({ ...e, d, x1, y1, x2, y2, mx, my });
    }
    let w = 0, h = 0;
    nodeEls.current.forEach(el => {
      if (!board.contains(el)) return;
      const r = el.getBoundingClientRect();
      w = Math.max(w, b.right - r.left);
      h = Math.max(h, r.bottom - b.top);
    });
    setPaths(next);
    setSize({ w: w + MAP.pad, h: h + MAP.pad });
  };

  mUseLayoutEffect(() => {
    let raf, stop = performance.now() + 900;
    const loop = () => { draw(); if (performance.now() < stop) raf = requestAnimationFrame(loop); };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [tasks, layout]);
  mUseLayoutEffect(() => { if (dragPos) draw(); }, [dragPos]);
  mUseEffect(() => {
    const ids = revealIds.current;
    revealIds.current = [];
    const el = ids.length && nodeEls.current.get(ids[0]);
    if (el) setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" }), 120);
  }, [tasks]);
  mUseEffect(() => {
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [layout]);

  // Open on where the work is.
  mUseEffect(() => {
    const t = setTimeout(() => {
      const id = canvasIds.find(x => states.get(x) !== "done");
      const el = id && nodeEls.current.get(id), canvas = canvasRef.current;
      if (!el || !canvas) return;
      const cr = canvas.getBoundingClientRect(), r = el.getBoundingClientRect();
      if (r.left < cr.left) canvas.scrollBy({ left: r.right - cr.right + 60, behavior: "smooth" });
    }, 500);
    return () => clearTimeout(t);
  }, []);

  // ── pointer interactions ───────────────────────────────────
  const boardPoint = (e) => {
    const b = boardRef.current.getBoundingClientRect();
    return { right: b.right - e.clientX, top: e.clientY - b.top, left: e.clientX - b.left };
  };
  const taskIdAt = (e) => document.elementFromPoint(e.clientX, e.clientY)?.closest?.("[data-task-id]")?.dataset.taskId;
  const inside = (el, e) => {
    const r = el?.getBoundingClientRect();
    return !!r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  };
  // Finish a link at whichever task is under the pointer.
  const finishLink = (e, cur) => {
    const target = taskIdAt(e);
    if (target && target !== cur.from) {
      if (cur.dir === "out") link(cur.from, target); else link(target, cur.from);
    }
    ix.current = null;
    setDraft(null);
  };

  const onPortDown = (e, id, dir) => {
    e.stopPropagation();
    e.preventDefault();
    const cur = ix.current;
    if (cur && cur.type === "link" && cur.armed) { finishLink(e, cur); return; }
    ix.current = { type: "link", from: id, dir, sx: e.clientX, sy: e.clientY, armed: false };
    setDraft({ from: id, dir, cx: e.clientX, cy: e.clientY });
    setSelEdge(null);
  };

  const onNodeDown = (e, id, inTray) => {
    if (e.button !== 0) return;
    e.preventDefault();                     // no text selection / native drag while dragging a card
    const cur = ix.current;
    if (cur && cur.type === "link" && cur.armed) { e.stopPropagation(); finishLink(e, cur); return; }
    const el = nodeEls.current.get(id);
    const r = el.getBoundingClientRect();
    ix.current = {
      type: inTray ? "tray" : "move", id, el,
      sx: e.clientX, sy: e.clientY, moved: false,
      grabRight: r.right - e.clientX, grabTop: e.clientY - r.top,
    };
    setSelEdge(null);
  };

  mUseEffect(() => {
    const move = (e) => {
      const cur = ix.current;
      if (!cur) return;
      if (cur.type === "link") {
        setDraft(d => d && { ...d, cx: e.clientX, cy: e.clientY });
        return;
      }
      if (!cur.moved && Math.hypot(e.clientX - cur.sx, e.clientY - cur.sy) <= 4) return;
      cur.moved = true;
      if (cur.type === "move") {
        const p = boardPoint(e);
        setDragPos({ id: cur.id, x: Math.max(8, p.right - cur.grabRight), y: Math.max(8, p.top - cur.grabTop) });
      } else {
        cur.el.classList.add("is-dragging");
        cur.el.style.transform = `translate(${e.clientX - cur.sx}px, ${e.clientY - cur.sy}px)`;
        canvasRef.current?.classList.toggle("is-drop-target", inside(canvasRef.current, e));
      }
    };
    const up = (e) => {
      const cur = ix.current;
      if (!cur) return;
      if (cur.type === "link") {
        if (!cur.armed && Math.hypot(e.clientX - cur.sx, e.clientY - cur.sy) <= 4) {
          cur.armed = true;          // a click on a point: now click the task to link to
          return;
        }
        finishLink(e, cur);
        return;
      }
      ix.current = null;
      if (!cur.moved) { onEdit(byId.get(cur.id)); return; }
      if (cur.type === "move") {
        const unlinked = layout.isolated.includes(cur.id);
        if (unlinked && inside(document.querySelector(".map-tray"), e)) commit(t => t, { [cur.id]: null });
        else if (dragPosRef.current) commit(t => t, { [cur.id]: dragPosRef.current });
        setDragPos(null);
      } else {
        cur.el.classList.remove("is-dragging");
        cur.el.style.transform = "";
        canvasRef.current?.classList.remove("is-drop-target");
        if (inside(canvasRef.current, e)) {
          const p = boardPoint(e);
          commit(t => t, { [cur.id]: { x: Math.max(8, p.right - cur.grabRight), y: Math.max(8, p.top - cur.grabTop) } });
        }
      }
    };
    const key = (e) => {
      if (e.key === "Escape") { ix.current = null; setDraft(null); setSelEdge(null); }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", key);
    };
  });

  // Delete / Backspace removes a selected line.
  mUseEffect(() => {
    if (!selEdge) return;
    const onKey = (e) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (e.target.closest && e.target.closest("input, textarea, select")) return;
      const [pre, dep] = selEdge.split(">");
      unlink(pre, dep);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selEdge, tasks]);

  const onCheck = (task, state, waitingOn, el) => {
    if (state === "blocked") {
      el.closest(".map-node")?.animate(
        [{ translate: "0" }, { translate: "-5px 0" }, { translate: "5px 0" }, { translate: "0" }],
        { duration: 280 });
      window.toastInfo?.("קודם צריך לסיים:", waitingOn.map(b => b.title).join(" · "));
      return;
    }
    const next = task.status === "done" ? "todo" : task.status === "doing" ? "done" : "doing";
    if (next === "done") window.celebrateDone(el, task, project);
    actions.updateTask(city.id, project.id, task.id, { status: next });
  };

  // A project with standard tasks but no links yet takes the standard order in one click.
  const standardLinked = mUseMemo(() => TM.linkStandardTasks(tasks), [tasks]);
  const canLinkStandard = layout.edges.length === 0 && standardLinked.some(t => t.dependsOn?.length);
  const linkStandard = () => actions.updateProject(city.id, project.id, { tasks: standardLinked });

  // ── render ─────────────────────────────────────────────────
  const counts = { ready: 0, doing: 0, blocked: 0, done: 0 };
  states.forEach(st => counts[st]++);

  const targetCls = (id) => {
    if (!draft || id === draft.from) return "";
    const ok = draft.dir === "out" ? canLink(draft.from, id) : canLink(id, draft.from);
    return ok ? " is-target-ok" : " is-target-bad";
  };
  const nodeProps = (id, inTray) => {
    const task = byId.get(id);
    const p = inTray ? null : posOf(id);
    return {
      key: id, task,
      state: states.get(id),
      blockers: blockers.get(id) || [],
      cls: (chain && !chain.has(id) ? " is-dim" : "") + (chain && chain.has(id) ? " is-lit" : "")
        + (unlocked.has(id) ? " just-unlocked" : "") + (dragPos && dragPos.id === id ? " is-moving" : "")
        + (draft && draft.from === id ? " is-link-source" : "") + targetCls(id),
      style: p ? { right: p.x, top: p.y } : undefined,
      nodeRef: (el) => { if (el) nodeEls.current.set(id, el); else nodeEls.current.delete(id); },
      onPointerDown: (e) => onNodeDown(e, id, inTray),
      onHover: setHover, onCheck, onPortDown,
    };
  };

  const edgeClass = (e) => {
    const from = states.get(e.from), to = states.get(e.to);
    const kind = from !== "done" ? "is-waiting" : to === "done" ? "is-done" : "is-live";
    const dim = chain && !(chain.has(e.from) && chain.has(e.to));
    const key = e.from + ">" + e.to;
    return "map-edge " + kind + (dim ? " is-dim" : "") + (chain && !dim ? " is-lit" : "") + (selEdge === key ? " is-selected" : "");
  };

  // Line being drawn, in screen coordinates (the source may sit in the tray,
  // outside the scrolling canvas), from the source point to the pointer.
  let draftPath = null;
  if (draft) {
    const el = nodeEls.current.get(draft.from);
    if (el) {
      const r = el.getBoundingClientRect();
      const sx = r.left + r.width / 2, sy = draft.dir === "out" ? r.bottom : r.top;
      const dy = Math.max(36, Math.abs(sy - draft.cy) * 0.5) * (draft.dir === "out" ? 1 : -1);
      draftPath = `M ${sx} ${sy} C ${sx} ${sy + dy}, ${draft.cx} ${draft.cy - dy}, ${draft.cx} ${draft.cy}`;
    }
  }
  const selected = selEdge && paths.find(p => p.from + ">" + p.to === selEdge);
  const boardH = Math.max(size.h, 360);

  return (
    <div className="taskmap">
      <div className="map-summary">
        <span className="map-stat is-ready"><b>{counts.ready}</b> מוכנות להתחלה</span>
        <span className="map-stat is-doing"><b>{counts.doing}</b> בתהליך</span>
        <span className="map-stat is-blocked"><b>{counts.blocked}</b> ממתינות</span>
        <span className="map-stat is-done"><b>{counts.done}</b> הושלמו</span>
        <span className="map-summary-spacer" />
        {canLinkStandard && (
          <button type="button" className="btn btn-sm btn-primary" onClick={linkStandard}>
            {window.Icon.flow}<span>קשר לפי סדר העבודה הסטנדרטי</span>
          </button>
        )}
        {layout.edges.length > 0 && (
          <button type="button" className="btn btn-sm" onClick={autoArrange} title="מסדר את המשימות המקושרות לפי שלבים">
            {window.Icon.flow}<span>סידור אוטומטי</span>
          </button>
        )}
      </div>

      <div className={"map-canvas" + (draft ? " is-linking" : "")} ref={canvasRef}
        onPointerDown={(e) => {
          if (e.target !== e.currentTarget && e.target !== boardRef.current && e.target.tagName !== "svg") return;
          setSelEdge(null);
          if (ix.current?.armed) { ix.current = null; setDraft(null); }   // click on empty space cancels linking
        }}>
        <div className="map-board" ref={boardRef} style={{ width: size.w, height: boardH }}>
          <svg className="map-lines" width={Math.max(size.w, 1)} height={boardH} aria-hidden="true">
            {paths.map(p => (
              <g key={p.from + ">" + p.to} className={edgeClass(p)}>
                <path className="map-edge-base" d={p.d} />
                <path className="map-edge-flow" d={p.d} />
                <path className="map-edge-hit" d={p.d}
                  onPointerDown={(e) => { e.stopPropagation(); setSelEdge(p.from + ">" + p.to); }} />
                <circle className="map-edge-start" cx={p.x1} cy={p.y1} r="3.5" />
                <circle className="map-edge-end" cx={p.x2} cy={p.y2} r="4.5" />
              </g>
            ))}
          </svg>
          {canvasIds.length === 0 && (
            <div className="map-hint">
              <strong>גררו לכאן משימות מהמגש למטה</strong>
              <span>ואז חברו ביניהן: גוררים מנקודה בצד של משימה אחת אל משימה אחרת.</span>
            </div>
          )}
          {canvasIds.map(id => <MapNode {...nodeProps(id, false)} />)}
          {selected && (
            <button type="button" className="map-unlink" style={{ left: selected.mx, top: selected.my }}
              title="הסר קישור" onPointerDown={(e) => e.stopPropagation()}
              onClick={() => unlink(selected.from, selected.to)}>
              {window.Icon.x}
            </button>
          )}
        </div>
      </div>
      <div className="map-help">
        {draft
          ? "בחרו משימה לחיבור · Esc לביטול"
          : <>גוררים מהנקודה <span className="map-help-dot" /> שבתחתית משימה אל המשימה שאחריה כדי לחבר · לוחצים על קו כדי לנתק · גוררים כרטיס כדי להזיז · לחיצה פותחת לעריכה</>}
      </div>

      {draftPath && (
        <svg className="map-draft-layer" aria-hidden="true"><path className="map-draft" d={draftPath} /></svg>
      )}

      {trayIds.length > 0 && (
        <div className="map-tray">
          <div className="map-tray-title">משימות בלי תלות — גררו אל המפה</div>
          <div className="map-tray-items">
            {trayIds.map(id => <MapNode {...nodeProps(id, true)} />)}
          </div>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { TaskMap });
