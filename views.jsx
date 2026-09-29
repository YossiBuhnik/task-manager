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
        placeholder="חיפוש בתחומים, מזמיני עבודה, פרויקטים ומשימות…"
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
// DASHBOARD: TODO list (open tasks ranked by urgency, one column per תחום)
// ───────────────────────────────────────────────────────────
const TODO_PAGE = 8;

function dueLabel(due) {
  const n = window.TM.daysUntil(due);
  if (n < 0)   return { text: `באיחור ${-n === 1 ? "יום" : -n + " ימים"}`, cls: "is-overdue" };
  if (n === 0) return { text: "היום", cls: "is-soon" };
  if (n === 1) return { text: "מחר", cls: "is-soon" };
  return { text: `בעוד ${n} ימים`, cls: n <= 3 ? "is-soon" : "" };
}

function TodoColumn({ group, actions }) {
  const [shown, setShown] = vUseState(TODO_PAGE);
  const { area, items, undated } = group;
  const visible = items.slice(0, shown);
  const more = items.length - visible.length;
  const openProject = (city, project) => window.go("/project/" + city.id + "/" + project.id);

  return (
    <div className="todo-col">
      <div className="todo-col-head">
        <h3>{area.name}</h3>
        {area.visibility === "private" && <span className="vis-badge" title="תחום פרטי">{window.Icon.lock}</span>}
        <span className="section-count">{items.length}</span>
      </div>

      {items.length === 0 && undated.length === 0 && (
        <div className="todo-empty">אין משימות פתוחות</div>
      )}

      {visible.map(({ task, city, project }) => {
        const due = dueLabel(task.due);
        const prio = window.TM.PRIORITY_BY_KEY[task.priority] || window.TM.PRIORITIES[1];
        const color = window.TM.areaColorFor(city.id);
        return (
          <div key={task.id} className="todo-item">
            <button className="task-check" title="סמן כהושלם"
              onClick={() => actions.updateTask(city.id, project.id, task.id, { status: "done" })} />
            <div className="todo-body">
              <div className="todo-title" onClick={() => openProject(city, project)}>{task.title}</div>
              <div className="todo-meta">
                <span className={"todo-due " + due.cls}>{due.text}</span>
                <span className={"prio-tag " + prio.cls}>{prio.label}</span>
                {task.status === "doing" && <span className="pill pill-doing">בתהליך</span>}
                <a className="todo-proj" href={"#/project/" + city.id + "/" + project.id}
                  style={{ "--area-color": color.bar, "--area-soft": color.soft, "--area-ink": color.ink }}>
                  {city.name} › {project.name}
                </a>
              </div>
            </div>
          </div>
        );
      })}

      {more > 0 && (
        <button className="btn btn-ghost btn-sm todo-more" onClick={() => setShown(s => s + TODO_PAGE)}>
          הצג עוד ({more})
        </button>
      )}

      {undated.length > 0 && (
        <div className="todo-undated">
          <div className="todo-undated-title">משימות פתוחות ללא תאריך יעד</div>
          {undated.map(({ city, project, count }) => (
            <a key={project.id} className="todo-undated-row"
              href={"#/project/" + city.id + "/" + project.id}>
              <span>{city.name} › {project.name}</span>
              <span className="section-count">{count}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function TodoPanel({ data, actions, userEmail }) {
  const [collapsed, setCollapsed] = vUseState(false);
  const groups = vUseMemo(() => window.buildTodos(data, userEmail), [data, userEmail]);
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  if (groups.length === 0) return null;
  return (
    <div className="section">
      <div className="section-head">
        <window.CollapseToggle collapsed={collapsed} onToggle={() => setCollapsed(v => !v)} />
        <h2>משימות לביצוע</h2>
        <span className="section-count">{total}</span>
      </div>
      {!collapsed && (
        <div className="todo-grid">
          {groups.map(g => <TodoColumn key={g.area.id} group={g} actions={actions} />)}
        </div>
      )}
    </div>
  );
}

// Does a client (or anything under it) match the search text?
function clientMatches(q, city, projects) {
  if (city.name.toLowerCase().includes(q)) return true;
  return projects.some(p =>
    p.name.toLowerCase().includes(q) ||
    (p.summary || "").toLowerCase().includes(q) ||
    p.tasks.some(t =>
      t.title.toLowerCase().includes(q) ||
      (t.assignee || "").toLowerCase().includes(q) ||
      (t.notes || "").toLowerCase().includes(q)
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
function DashboardView({ data, actions, search, userEmail }) {
  const [collapsed, setCollapsed] = vUseState(false);
  const [showAreaModal, setShowAreaModal] = vUseState(false);
  const [editArea, setEditArea] = vUseState(null);
  const [confirmDel, setConfirmDel] = vUseState(null);

  const summary = vUseMemo(() => window.summarize(data, userEmail), [data, userEmail]);
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
      <div className="page-head">
        <div>
          <h1 className="page-title">סקירה כללית</h1>
          <p className="page-sub">מעקב התקדמות פרויקטים בכל התחומים</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAreaModal(true)}>
          {window.Icon.plus}<span>הוסף תחום</span>
        </button>
      </div>

      <div className="kpis">
        <div className="kpi k-areas">
          <div className="kpi-label">תחומים</div>
          <div className="kpi-value">{summary.areas}</div>
          <div className="kpi-sub">{summary.clients} מזמיני עבודה</div>
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

      {!search && <TodoPanel data={data} actions={actions} userEmail={userEmail} />}

      <div className="section">
        <div className="section-head">
          <window.CollapseToggle collapsed={collapsed} onToggle={() => setCollapsed(v => !v)} />
          <h2>תחומים</h2>
          <span className="section-count">{filteredTree.length}</span>
          <div className="section-spacer" />
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
      <div className="page-head">
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
      <div className="page-head">
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
        { label: area.name, href: "/area/" + area.id },
        { label: city.name, href: "/city/" + city.id },
        { label: project.name },
      ]} />
      <div className="page-head">
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

Object.assign(window, { TopBar, Crumbs, DashboardView, AreaView, CityView, ProjectView });
