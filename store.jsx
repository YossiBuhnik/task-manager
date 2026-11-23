// store.jsx — state management + actions + hash routing
// Loaded as Babel script; depends on data.js (window.TM) and React.

const STORAGE_KEY = "tm_data_v1";

function loadInitial() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return window.TM.rollAllRecurring(window.TM.migrate(JSON.parse(raw)));
  } catch (e) { /* fall through */ }
  return JSON.parse(JSON.stringify(window.TM.SEED));
}

function findTaskInData(data, taskId) {
  for (const t of window.TM.allTasks(data || { cities: [] })) {
    if (t.id === taskId) return t;
  }
  return null;
}

function useStore(cloud) {
  const isCloud = cloud && cloud.mode === "signedIn";
  const writesOn = !!(isCloud && cloud.writesEnabled);
  const [data, setData] = React.useState(() => isCloud ? null : loadInitial());
  const skipNextSave = React.useRef(false);
  const dataRef = React.useRef(data);
  dataRef.current = data;
  const cloudRef = React.useRef(cloud);
  cloudRef.current = cloud;

  const userEmail = () => (cloudRef.current && cloudRef.current.user && cloudRef.current.user.email) || "";

  // ── pull remote → local when cloud data arrives ──
  React.useEffect(() => {
    if (!isCloud) return;
    if (cloud.data) {
      const migrated = window.TM.migrate(cloud.data);
      const rolled = window.TM.rollAllRecurring(migrated);
      skipNextSave.current = true;
      setData(rolled);
      if (writesOn && rolled !== migrated) {
        // Persist recurrences as per-task updates, never as a blob write.
        const before = new Map(window.TM.allTasks(migrated).map((t) => [t.id, t]));
        for (const t of window.TM.allTasks(rolled)) {
          const prev = before.get(t.id);
          if (prev && (prev.due !== t.due || prev.status !== t.status || prev.lastDone !== t.lastDone)) {
            cloud.updateTaskDoc(t.id, { due: t.due, status: t.status, lastDone: t.lastDone }, t.version);
          }
        }
      }
    }
  }, [isCloud, writesOn, cloud && cloud.data]);

  // ── persist local → localStorage only. Cloud task/team writes go through
  //    per-document APIs in the actions; the debounce full-blob save is gone. ──
  React.useEffect(() => {
    if (data === null) return;
    if (skipNextSave.current) { skipNextSave.current = false; return; }
    if (isCloud) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) {}
  }, [data, isCloud]);

  const update = React.useCallback((fn) => setData(prev => fn(prev)), []);

  const persistTeam = (next) => {
    const c = cloudRef.current;
    if (c && c.writesEnabled) {
      const state = window.TM.teamStateForWrite(next);
      c.updateTeamState(state);
    }
    return next;
  };

  const persistNewTask = (task) => {
    const c = cloudRef.current;
    if (c && c.writesEnabled) c.createTask(task);
  };

  const persistTaskUpdate = (task, fields) => {
    const c = cloudRef.current;
    if (c && c.writesEnabled) c.updateTaskDoc(task.id, fields, task.version);
  };

  const persistTaskDelete = (task) => {
    const c = cloudRef.current;
    if (c && c.writesEnabled) c.deleteTaskDoc(task.id, task.version);
  };

  const guardEdit = (task) => {
    if (!isCloud) return true;
    const email = userEmail();
    if (!window.TM.canEditTask(task, email, dataRef.current)) {
      console.warn("edit blocked by client guard", task && task.id);
      return false;
    }
    return true;
  };

  const guardApprove = (task) => {
    if (!isCloud) return true;
    if (!window.TM.canApproveTask(task, userEmail(), dataRef.current)) {
      console.warn("approve blocked by client guard", task && task.id);
      return false;
    }
    return true;
  };

  const actions = React.useMemo(() => ({
    // AREA (תחום)
    addArea: (name, opts = {}) => update(d => persistTeam({ ...d, areas: [...d.areas, window.TM.newArea(name, opts)] })),
    updateArea: (areaId, fields) => update(d => persistTeam({
      ...d,
      areas: d.areas.map(a => a.id === areaId ? { ...a, ...fields } : a),
    })),
    deleteArea: (areaId) => update(d => persistTeam({
      ...d,
      areas: d.areas.filter(a => a.id !== areaId),
      cities: d.cities.map(c => c.areaId === areaId ? { ...c, areaId: null } : c),
    })),
    reorderAreas: (fromIdx, toIdx) => update(d => {
      const next = [...d.areas];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return persistTeam({ ...d, areas: next });
    }),

    // CITY (מזמין עבודה)
    addCity: (name, opts = {}) => update(d => persistTeam({ ...d, cities: [...d.cities, window.TM.newCity(name, opts)] })),
    updateCity: (cityId, fields) => update(d => persistTeam({
      ...d,
      cities: d.cities.map(c => c.id === cityId ? { ...c, ...fields } : c),
    })),
    deleteCity: (cityId) => update(d => {
      const city = d.cities.find(c => c.id === cityId);
      if (city) {
        for (const p of city.projects || []) {
          for (const t of p.tasks || []) persistTaskDelete(t);
        }
      }
      return persistTeam({
        ...d, cities: d.cities.filter(c => c.id !== cityId),
      });
    }),
    reorderCities: (fromIdx, toIdx) => update(d => {
      const next = [...d.cities];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return persistTeam({ ...d, cities: next });
    }),

    // PROJECT
    addProject: (cityId, name, summary, withStandardTasks, opts = {}) => update(d => {
      const project = {
        ...window.TM.newProject(name, summary, opts),
        tasks: [],
      };
      const std = withStandardTasks ? window.TM.standardTasks() : [];
      const city = d.cities.find(c => c.id === cityId);
      const tasks = std.map((t) => window.TM.normalizeTask({
        ...t, projectId: project.id, cityId, areaId: city ? city.areaId : "",
        source: "", awaitingReview: false,
      }, d, userEmail()));
      const next = {
        ...d,
        cities: d.cities.map(c => c.id === cityId ? {
          ...c,
          projects: [...c.projects, { ...project, tasks }],
        } : c),
      };
      persistTeam(next);
      tasks.forEach(persistNewTask);
      return next;
    }),
    updateProject: (cityId, projectId, fields) => update(d => persistTeam({
      ...d,
      cities: d.cities.map(c => c.id === cityId ? {
        ...c,
        projects: c.projects.map(p => p.id === projectId ? { ...p, ...fields } : p),
      } : c),
    })),
    deleteProject: (cityId, projectId) => update(d => {
      const city = d.cities.find(c => c.id === cityId);
      const project = city && city.projects.find(p => p.id === projectId);
      if (project) for (const t of project.tasks || []) persistTaskDelete(t);
      return persistTeam({
        ...d,
        cities: d.cities.map(c => c.id === cityId ? {
          ...c, projects: c.projects.filter(p => p.id !== projectId),
        } : c),
      });
    }),
    reorderProjects: (cityId, fromIdx, toIdx) => update(d => persistTeam({
      ...d,
      cities: d.cities.map(c => {
        if (c.id !== cityId) return c;
        const next = [...c.projects];
        const [moved] = next.splice(fromIdx, 1);
        next.splice(toIdx, 0, moved);
        return { ...c, projects: next };
      }),
    })),
    addStandardTasks: (cityId, projectId) => update(d => {
      const city = d.cities.find(c => c.id === cityId);
      const added = window.TM.standardTasks().map((t) => window.TM.normalizeTask({
        ...t, projectId, cityId, areaId: city ? city.areaId : "",
        source: "", awaitingReview: false,
      }, d, userEmail()));
      added.forEach(persistNewTask);
      return {
        ...d,
        cities: d.cities.map(c => c.id === cityId ? {
          ...c,
          projects: c.projects.map(p => p.id === projectId ? {
            ...p, tasks: [...p.tasks, ...added],
          } : p),
        } : c),
      };
    }),

    // TASK — signatures unchanged so the UI keeps working.
    addTask: (cityId, projectId, fields) => update(d => {
      const city = d.cities.find(c => c.id === cityId);
      const base = window.TM.newTask(typeof fields === "string" ? fields : (fields.title || ""));
      const merged = window.TM.rollTask(typeof fields === "string" ? base : { ...base, ...fields });
      const nextTask = window.TM.normalizeTask({
        ...merged,
        projectId, cityId, areaId: city ? city.areaId : "",
        source: (merged.source != null && merged.source !== undefined) ? merged.source : "",
        awaitingReview: false,
        createdBy: userEmail() || "yossi",
      }, d, userEmail());
      if (isCloud && window.TM.isBotSourceKey(nextTask.source) && !window.TM.isYossi(userEmail())) {
        console.warn("create blocked: client may not write a bot source");
        return d;
      }
      persistNewTask(nextTask);
      return {
        ...d,
        cities: d.cities.map(c => c.id === cityId ? {
          ...c,
          projects: c.projects.map(p => p.id === projectId ? {
            ...p, tasks: [...p.tasks, nextTask],
          } : p),
        } : c),
      };
    }),
    updateTask: (cityId, projectId, taskId, fields) => update(d => {
      const current = findTaskInData(d, taskId);
      if (!current || !guardEdit(current)) return d;
      const rolled = window.TM.rollTask({ ...current, ...fields });
      persistTaskUpdate(current, fields);
      return {
        ...d,
        cities: d.cities.map(c => c.id === cityId ? {
          ...c,
          projects: c.projects.map(p => p.id === projectId ? {
            ...p, tasks: p.tasks.map(t => t.id === taskId ? rolled : t),
          } : p),
        } : c),
      };
    }),
    deleteTask: (cityId, projectId, taskId) => update(d => {
      const current = findTaskInData(d, taskId);
      if (!current || !guardEdit(current)) return d;
      persistTaskDelete(current);
      return {
        ...d,
        cities: d.cities.map(c => c.id === cityId ? {
          ...c,
          projects: c.projects.map(p => p.id === projectId ? {
            ...p,
            tasks: p.tasks.filter(t => t.id !== taskId).map(t =>
              (t.dependsOn || []).includes(taskId)
                ? { ...t, dependsOn: t.dependsOn.filter(id => id !== taskId) } : t),
          } : p),
        } : c),
      };
    }),
    reorderTasks: (cityId, projectId, fromIdx, toIdx) => update(d => ({
      ...d,
      cities: d.cities.map(c => c.id === cityId ? {
        ...c,
        projects: c.projects.map(p => {
          if (p.id !== projectId) return p;
          const next = [...p.tasks];
          const [moved] = next.splice(fromIdx, 1);
          next.splice(toIdx, 0, moved);
          next.forEach((t, i) => {
            if (t.pos !== i) persistTaskUpdate(t, { pos: i });
          });
          return { ...p, tasks: next.map((t, i) => ({ ...t, pos: i })) };
        }),
      } : c),
    })),

    moveTask: (taskId, targetProjectId) => update(d => {
      const current = findTaskInData(d, taskId);
      if (!current || !guardEdit(current)) return d;
      if (isCloud && !window.TM.isYossi(userEmail())) {
        console.warn("move blocked: admin only", taskId);
        return d;
      }
      const plan = window.TM.moveTaskInState(d, taskId, targetProjectId);
      if (!plan.ok || !plan.moved) return plan.ok ? plan.state : d;
      const c = cloudRef.current;
      if (c && c.writesEnabled && c.moveTaskDoc) c.moveTaskDoc(taskId, targetProjectId);
      return plan.state;
    }),

    approveTask: (cityIdOrId, projectId, taskId) => update(d => {
      const id = taskId || cityIdOrId;
      const current = findTaskInData(d, id);
      if (!current || !guardApprove(current)) return d;
      persistTaskUpdate(current, { awaitingReview: false });
      const patch = (t) => t.id === id ? { ...t, awaitingReview: false } : t;
      return {
        ...d,
        cities: d.cities.map(c => ({
          ...c,
          projects: c.projects.map(p => ({ ...p, tasks: p.tasks.map(patch) })),
        })),
      };
    }),

    resolveDup: (taskId, resolution = {}) => update(d => {
      const current = findTaskInData(d, taskId);
      if (!current || !guardEdit(current)) return d;
      const fields = {
        dupGroup: resolution.dupGroup != null ? resolution.dupGroup : "",
        dupLabel: resolution.dupLabel != null ? resolution.dupLabel : "",
      };
      persistTaskUpdate(current, fields);
      return {
        ...d,
        cities: d.cities.map(c => ({
          ...c,
          projects: c.projects.map(p => ({
            ...p,
            tasks: p.tasks.map(t => t.id === taskId ? { ...t, ...fields } : t),
          })),
        })),
      };
    }),

    listByUrgency: (opts) => window.TM.listByUrgency(window.TM.allTasks(dataRef.current), opts),
    listTopUrgent: (opts) => window.TM.listTopUrgent(window.TM.allTasks(dataRef.current), opts),
    listInbox: () => window.TM.listInbox(window.TM.allTasks(dataRef.current)),

    // DATA — replaceAll / resetSeed are local/demo only. In signed-in cloud
    // mode they no-op (both legacy and per-task paths).
    replaceAll: (newData) => {
      const isCloudNow = !!(cloudRef.current && cloudRef.current.mode === "signedIn");
      if (!window.TM.canBulkReplaceData(isCloudNow)) {
        console.warn("replaceAll is disabled in cloud mode; local/demo only");
        return;
      }
      setData(window.TM.migrate(newData));
    },
    resetSeed: () => {
      const isCloudNow = !!(cloudRef.current && cloudRef.current.mode === "signedIn");
      if (!window.TM.canBulkReplaceData(isCloudNow)) {
        console.warn("resetSeed is disabled in cloud mode; local/demo only");
        return;
      }
      setData(JSON.parse(JSON.stringify(window.TM.SEED)));
    },
    clearAll: () => {
      const cur = dataRef.current;
      if (cur) for (const t of window.TM.allTasks(cur)) persistTaskDelete(t);
      const empty = { areas: [], cities: [] };
      setData(empty);
      persistTeam(empty);
    },
  }), [update, isCloud]);

  return [data, actions];
}

// ─── derived helpers ──────────────────────────────────────────
const UNASSIGNED_AREA = { id: "__none", name: "ללא תחום", visibility: "shared", owner: null, isUnassigned: true };

function visibleTree(data, userEmail) {
  const canSee = window.TM.canSee;
  const areaIds = new Set(data.areas.map(a => a.id));
  const clientsOf = (area) => data.cities
    .filter(c => area.isUnassigned ? !areaIds.has(c.areaId) : c.areaId === area.id)
    .filter(c => canSee(c, userEmail))
    .map(city => ({ city, projects: city.projects.filter(p => canSee(p, userEmail)) }));
  const tree = data.areas
    .filter(a => canSee(a, userEmail))
    .map(area => ({ area, clients: clientsOf(area) }));
  const unassigned = clientsOf(UNASSIGNED_AREA);
  if (unassigned.length) tree.push({ area: UNASSIGNED_AREA, clients: unassigned });
  return tree;
}

function summarize(data, userEmail) {
  const tree = visibleTree(data, userEmail);
  let clients = 0, projects = 0, tasks = 0, doneTasks = 0, doingTasks = 0;
  let weightedSum = 0;
  for (const { clients: cs } of tree) {
    for (const { projects: ps } of cs) {
      clients++;
      for (const p of ps) {
        projects++;
        for (const t of p.tasks) {
          tasks++;
          weightedSum += window.TM.STATUS_BY_KEY[t.status]?.weight ?? 0;
          if (t.status === "done") doneTasks++;
          if (t.status === "doing") doingTasks++;
        }
      }
    }
  }
  const overall = tasks ? Math.round((weightedSum / tasks) * 100) : 0;
  return {
    areas: tree.filter(n => !n.area.isUnassigned).length,
    clients, projects, tasks, doneTasks, doingTasks,
    overall,
  };
}

function buildTodos(data, userEmail) {
  const { todoScore } = window.TM;
  return visibleTree(data, userEmail).map(({ area, clients }) => {
    const items = [], undated = [];
    for (const { city, projects } of clients) {
      for (const project of projects) {
        let count = 0;
        for (const task of project.tasks) {
          if (task.status === "done") continue;
          if (!task.due) { count++; continue; }
          items.push({ task, city, project, score: todoScore(task) });
        }
        if (count) undated.push({ city, project, count });
      }
    }
    items.sort((a, b) => b.score - a.score);
    return { area, items, undated };
  });
}

function listByUrgency(data, opts) {
  return window.TM.listByUrgency(window.TM.allTasks(data), opts);
}
function listTopUrgent(data, opts) {
  return window.TM.listTopUrgent(window.TM.allTasks(data), opts);
}
function listInbox(data) {
  return window.TM.listInbox(window.TM.allTasks(data));
}

function findArea(data, areaId) {
  if (areaId === UNASSIGNED_AREA.id) return UNASSIGNED_AREA;
  return data.areas.find(a => a.id === areaId) || null;
}
function areaOf(data, city) {
  return data.areas.find(a => a.id === city.areaId) || UNASSIGNED_AREA;
}

function findCity(data, cityId) {
  return data.cities.find(c => c.id === cityId) || null;
}
function findProject(data, cityId, projectId) {
  const city = findCity(data, cityId);
  if (!city) return [null, null];
  const project = city.projects.find(p => p.id === projectId) || null;
  return [city, project];
}

function parseHash() {
  const h = (window.location.hash || "#/").replace(/^#/, "");
  const parts = h.split("/").filter(Boolean);
  if (parts.length === 0) return { view: "dashboard" };
  if (parts[0] === "area" && parts[1]) return { view: "area", areaId: parts[1] };
  if (parts[0] === "city" && parts[1]) return { view: "city", cityId: parts[1] };
  if (parts[0] === "project" && parts[1] && parts[2])
    return { view: "project", cityId: parts[1], projectId: parts[2] };
  return { view: "dashboard" };
}
function useRoute() {
  const [route, setRoute] = React.useState(parseHash);
  React.useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return route;
}
function go(path) {
  window.location.hash = path;
}

Object.assign(window, {
  useStore, useRoute, go,
  UNASSIGNED_AREA, visibleTree, summarize, buildTodos,
  listByUrgency, listTopUrgent, listInbox,
  findArea, areaOf, findCity, findProject,
});
