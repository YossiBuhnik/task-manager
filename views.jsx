// views.jsx — Dashboard, City, Project views + Task row
// Depends on: React, window.TM, window.useDragList, window.go, etc.

const { useState: vUseState, useMemo: vUseMemo, useEffect: vUseEffect } = React;

// ───────────────────────────────────────────────────────────
// SHARED: Top bar
// ───────────────────────────────────────────────────────────
function TopBar({ search, onSearchChange }) {
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">מ</div>
        <span>מנהל פרויקטים</span>
      </div>
      <div className="topbar-spacer" />
      <input
        className="search-input"
        placeholder="חיפוש בערים, פרויקטים ומשימות…"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
      />
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
// DASHBOARD VIEW
// ───────────────────────────────────────────────────────────
function DashboardView({ data, actions, search, userEmail }) {
  const [collapsed, setCollapsed] = vUseState(false);
  const [showCityModal, setShowCityModal] = vUseState(false);
  const [editCity, setEditCity] = vUseState(null);
  const [confirmDel, setConfirmDel] = vUseState(null);

  const summary = vUseMemo(() => window.summarize(data), [data]);
  const drag = window.useDragList((from, to) => actions.reorderCities(from, to));

  // ── visibility filter: hide other people's private תחומים ──
  const accessibleCities = vUseMemo(() =>
    data.cities.filter(c =>
      !c.visibility || c.visibility === "shared" || !userEmail || c.owner === userEmail
    ),
  [data.cities, userEmail]);

  // ── search-filtered city list (also matches by project/task content)
  const filteredCities = vUseMemo(() => {
    if (!search) return accessibleCities;
    const q = search.toLowerCase();
    return accessibleCities.filter(c => {
      if (c.name.toLowerCase().includes(q)) return true;
      return c.projects.some(p =>
        p.name.toLowerCase().includes(q) ||
        (p.summary || "").toLowerCase().includes(q) ||
        p.tasks.some(t =>
          t.title.toLowerCase().includes(q) ||
          (t.assignee || "").toLowerCase().includes(q) ||
          (t.notes || "").toLowerCase().includes(q)
        )
      );
    });
  }, [data.cities, search]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">סקירה כללית</h1>
          <p className="page-sub">מעקב התקדמות פרויקטים בכל התחומים</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCityModal(true)}>
          {window.Icon.plus}<span>הוסף תחום</span>
        </button>
      </div>

      <div className="kpis">
        <div className="kpi k-areas">
          <div className="kpi-label">תחומים</div>
          <div className="kpi-value">{summary.cities}</div>
        </div>
        <div className="kpi k-projects">
          <div className="kpi-label">פרויקטים</div>
          <div className="kpi-value">{summary.projects}</div>
        </div>
        <div className="kpi k-tasks">
          <div className="kpi-label">משימות</div>
          <div className="kpi-value">{summary.tasks}</div>
          <div className="kpi-sub">{summary.doingTasks} בתהליך · {summary.doneTasks} הושלמו</div>
        </div>
        <div className="kpi k-progress">
          <div className="kpi-label">התקדמות כוללת</div>
          <div className="kpi-value">{summary.overall}%</div>
          <div className="kpi-sub" style={{ marginTop: 10 }}>
            <div className="progress"><div className="progress-fill" style={{ width: summary.overall + "%", background: "#65a30d" }} /></div>
          </div>
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <window.CollapseToggle collapsed={collapsed} onToggle={() => setCollapsed(v => !v)} />
          <h2>תחומים</h2>
          <span className="section-count">{filteredCities.length}</span>
          <div className="section-spacer" />
        </div>

        {!collapsed && (
          filteredCities.length === 0 ? (
            <div className="empty">
              <h3>{search ? "לא נמצאו תוצאות" : "אין עדיין תחומים"}</h3>
              <p>{search ? "נסה ביטוי אחר" : "התחל בהוספת תחום ראשון למעקב — עיר, משרד, או כל קבוצת פרויקטים"}</p>
              {!search && (
                <button className="btn btn-primary" onClick={() => setShowCityModal(true)}>
                  {window.Icon.plus}<span>הוסף תחום</span>
                </button>
              )}
            </div>
          ) : (
            <div className="cards">
              {filteredCities.map((c, idx) => {
                const allTasks = c.projects.flatMap(p => p.tasks);
                const progress = window.TM.tasksProgress(allTasks);
                const realIdx = data.cities.indexOf(c);
                const st = drag.stateFor(realIdx);
                const color = window.TM.areaColorFor(c.id);
                return (
                  <div
                    key={c.id}
                    className={"card card-tinted "
                      + (st.isDragging ? "is-dragging " : "")
                      + (st.isOverAbove ? "drop-above " : "")
                      + (st.isOverBelow ? "drop-below " : "")}
                    style={{ "--area-color": color.bar, "--area-soft": color.soft, "--area-ink": color.ink }}
                    onClick={() => window.go("/city/" + c.id)}
                    {...drag.handlers(realIdx)}
                  >
                    <div className="card-head">
                      <div className="card-title-row">
                        <span className="card-chip" />
                        <h3 className="card-title">{c.name}</h3>
                        {c.visibility === "private" && (
                          <span className="vis-badge" title="תחום פרטי — רואה רק אתה">
                            {window.Icon.lock}
                          </span>
                        )}
                      </div>
                      <div className="card-actions" onClick={(e) => e.stopPropagation()}>
                        <button className="btn btn-ghost btn-icon" title="עריכה"
                          onClick={() => setEditCity(c)}>{window.Icon.edit}</button>
                        <button className="btn btn-ghost btn-icon btn-danger" title="מחיקה"
                          onClick={() => setConfirmDel(c)}>{window.Icon.trash}</button>
                      </div>
                    </div>
                    <div className="card-meta">
                      <span><strong>{c.projects.length}</strong> פרויקטים</span>
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

      {showCityModal && (
        <window.CityModal
          currentUserEmail={userEmail}
          showVisibility={!!userEmail}
          onSave={(fields) => { actions.addCity(fields.name, fields); setShowCityModal(false); }}
          onClose={() => setShowCityModal(false)}
        />
      )}
      {editCity && (
        <window.CityModal
          city={editCity}
          currentUserEmail={userEmail}
          showVisibility={!!userEmail}
          onSave={(fields) => { actions.updateCity(editCity.id, fields); setEditCity(null); }}
          onClose={() => setEditCity(null)}
        />
      )}
      {confirmDel && (
        <window.ConfirmModal
          title="מחיקת תחום"
          message={`למחוק את "${confirmDel.name}" וכל הפרויקטים שבו?`}
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

  // Block access to other people's private תחומים
  if (city && city.visibility === "private" && userEmail && city.owner !== userEmail) {
    return (
      <div className="empty">
        <h3>אין גישה</h3>
        <p>תחום זה פרטי למשתמש אחר.</p>
        <button className="btn" onClick={() => window.go("/")}>חזרה לסקירה</button>
      </div>
    );
  }

  if (!city) {
    return (
      <div className="empty">
        <h3>עיר לא נמצאה</h3>
        <p>ייתכן שהעיר נמחקה.</p>
        <button className="btn" onClick={() => window.go("/")}>חזרה לסקירה</button>
      </div>
    );
  }

  const filtered = vUseMemo(() => {
    if (!search) return city.projects;
    const q = search.toLowerCase();
    return city.projects.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.summary || "").toLowerCase().includes(q) ||
      p.tasks.some(t => t.title.toLowerCase().includes(q))
    );
  }, [city.projects, search]);

  const allTasks = city.projects.flatMap(p => p.tasks);
  const progress = window.TM.tasksProgress(allTasks);
  const cityColor = window.TM.areaColorFor(city.id);

  return (
    <>
      <Crumbs items={[{ label: "סקירה", href: "/" }, { label: city.name }]} />
      <div className="page-head">
        <div>
          <span className="area-pill"
            style={{ "--area-color": cityColor.bar, "--area-soft": cityColor.soft, "--area-ink": cityColor.ink }}>
            {city.visibility === "private" ? <>{window.Icon.lock}<span>תחום פרטי</span></> : "תחום"}
          </span>
          <h1 className="page-title">{city.name}</h1>
          <p className="page-sub">
            {city.projects.length} פרויקטים · {allTasks.length} משימות · {progress}% התקדמות
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
                  <h3 className="card-title">{p.name}</h3>
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
          onSave={({ name, summary, withStandardTasks }) => {
            actions.addProject(city.id, name, summary, withStandardTasks);
            setShowModal(false);
          }}
          onClose={() => setShowModal(false)}
        />
      )}
      {editProj && (
        <window.ProjectModal
          project={editProj}
          onSave={({ name, summary }) => {
            actions.updateProject(city.id, editProj.id, { name, summary });
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

  const cycleStatus = () => {
    const order = ["todo", "doing", "done"];
    const cur = order.indexOf(task.status);
    const next = order[(cur + 1) % order.length];
    actions.updateTask(city.id, project.id, task.id, { status: next });
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
        </div>

        <div className="task-status-cell">
          <select
            value={task.status}
            onChange={(e) => actions.updateTask(city.id, project.id, task.id, { status: e.target.value })}
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
      {expanded && task.notes && (
        <div className="task-notes-row">{task.notes}</div>
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

  if (!city || !project) {
    return (
      <div className="empty">
        <h3>פרויקט לא נמצא</h3>
        <button className="btn" onClick={() => window.go("/")}>חזרה לסקירה</button>
      </div>
    );
  }

  // Block access to projects inside other people's private תחומים
  if (city.visibility === "private" && userEmail && city.owner !== userEmail) {
    return (
      <div className="empty">
        <h3>אין גישה</h3>
        <p>הפרויקט שייך לתחום פרטי למשתמש אחר.</p>
        <button className="btn" onClick={() => window.go("/")}>חזרה לסקירה</button>
      </div>
    );
  }

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
                 (t.notes || "").toLowerCase().includes(q))) return;
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
        { label: city.name, href: "/city/" + city.id },
        { label: project.name },
      ]} />
      <div className="page-head">
        <div>
          <span className="area-pill"
            style={{ "--area-color": cityColor.bar, "--area-soft": cityColor.soft, "--area-ink": cityColor.ink }}>
            {city.name}
          </span>
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

      <div className="kpis" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <div className="kpi">
          <div className="kpi-label">התקדמות</div>
          <div className="kpi-value">{pct}%</div>
          <div className="kpi-sub" style={{ marginTop: 10 }}>
            <div className="progress"><div className="progress-fill" style={{ width: pct + "%" }} /></div>
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">לא התחילו</div>
          <div className="kpi-value">{counts.todo}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">בתהליך</div>
          <div className="kpi-value">{counts.doing}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">הושלמו</div>
          <div className="kpi-value">{counts.done}</div>
        </div>
      </div>

      <div className="toolbar">
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
      </div>

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

      {showAdd && (
        <window.TaskModal
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
          onSave={(fields) => {
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
          onSave={({ name, summary }) => {
            actions.updateProject(city.id, project.id, { name, summary });
            setEditProj(false);
          }}
          onClose={() => setEditProj(false)}
        />
      )}
    </>
  );
}

Object.assign(window, { TopBar, Crumbs, DashboardView, CityView, ProjectView });
