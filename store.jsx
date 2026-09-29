// store.jsx — state management + actions + hash routing
// Loaded as Babel script; depends on data.js (window.TM) and React.

const STORAGE_KEY = "tm_data_v1";

function loadInitial() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return window.TM.migrate(JSON.parse(raw));
  } catch (e) { /* fall through */ }
  return JSON.parse(JSON.stringify(window.TM.SEED));
}

function useStore(cloud) {
  const isCloud = cloud && cloud.mode === "signedIn";
  const [data, setData] = React.useState(() => isCloud ? null : loadInitial());
  const skipNextSave = React.useRef(false);

  // ── pull remote → local when cloud data arrives ──
  React.useEffect(() => {
    if (!isCloud) return;
    if (cloud.data) {
      skipNextSave.current = true;
      setData(window.TM.migrate(cloud.data));
    }
  }, [isCloud, cloud && cloud.data]);

  // ── persist local → backing store ──
  React.useEffect(() => {
    if (data === null) return;
    if (skipNextSave.current) { skipNextSave.current = false; return; }
    if (isCloud) {
      cloud.save(data);
    } else {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) {}
    }
  }, [data, isCloud]);

  // ─── update helpers (immutable) ─────────────────────────────
  const update = React.useCallback((fn) => setData(prev => fn(prev)), []);

  const actions = React.useMemo(() => ({
    // AREA (תחום)
    addArea: (name, opts = {}) => update(d => ({ ...d, areas: [...d.areas, window.TM.newArea(name, opts)] })),
    updateArea: (areaId, fields) => update(d => ({
      ...d,
      areas: d.areas.map(a => a.id === areaId ? { ...a, ...fields } : a),
    })),
    // Deleting an area keeps its clients — they move to "ללא תחום".
    deleteArea: (areaId) => update(d => ({
      ...d,
      areas: d.areas.filter(a => a.id !== areaId),
      cities: d.cities.map(c => c.areaId === areaId ? { ...c, areaId: null } : c),
    })),
    reorderAreas: (fromIdx, toIdx) => update(d => {
      const next = [...d.areas];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return { ...d, areas: next };
    }),

    // CITY (מזמין עבודה)
    addCity: (name, opts = {}) => update(d => ({ ...d, cities: [...d.cities, window.TM.newCity(name, opts)] })),
    updateCity: (cityId, fields) => update(d => ({
      ...d,
      cities: d.cities.map(c => c.id === cityId ? { ...c, ...fields } : c),
    })),
    deleteCity: (cityId) => update(d => ({
      ...d, cities: d.cities.filter(c => c.id !== cityId),
    })),
    reorderCities: (fromIdx, toIdx) => update(d => {
      const next = [...d.cities];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return { ...d, cities: next };
    }),

    // PROJECT
    addProject: (cityId, name, summary, withStandardTasks, opts = {}) => update(d => ({
      ...d,
      cities: d.cities.map(c => c.id === cityId ? {
        ...c,
        projects: [...c.projects, {
          ...window.TM.newProject(name, summary, opts),
          tasks: withStandardTasks ? window.TM.standardTasks() : [],
        }],
      } : c),
    })),
    updateProject: (cityId, projectId, fields) => update(d => ({
      ...d,
      cities: d.cities.map(c => c.id === cityId ? {
        ...c,
        projects: c.projects.map(p => p.id === projectId ? { ...p, ...fields } : p),
      } : c),
    })),
    deleteProject: (cityId, projectId) => update(d => ({
      ...d,
      cities: d.cities.map(c => c.id === cityId ? {
        ...c, projects: c.projects.filter(p => p.id !== projectId),
      } : c),
    })),
    reorderProjects: (cityId, fromIdx, toIdx) => update(d => ({
      ...d,
      cities: d.cities.map(c => {
        if (c.id !== cityId) return c;
        const next = [...c.projects];
        const [moved] = next.splice(fromIdx, 1);
        next.splice(toIdx, 0, moved);
        return { ...c, projects: next };
      }),
    })),
    addStandardTasks: (cityId, projectId) => update(d => ({
      ...d,
      cities: d.cities.map(c => c.id === cityId ? {
        ...c,
        projects: c.projects.map(p => p.id === projectId ? {
          ...p, tasks: [...p.tasks, ...window.TM.standardTasks()],
        } : p),
      } : c),
    })),

    // TASK
    addTask: (cityId, projectId, fields) => update(d => {
      const base = window.TM.newTask(typeof fields === "string" ? fields : (fields.title || ""));
      const next = typeof fields === "string" ? base : { ...base, ...fields };
      return {
        ...d,
        cities: d.cities.map(c => c.id === cityId ? {
          ...c,
          projects: c.projects.map(p => p.id === projectId ? {
            ...p, tasks: [...p.tasks, next],
          } : p),
        } : c),
      };
    }),
    updateTask: (cityId, projectId, taskId, fields) => update(d => ({
      ...d,
      cities: d.cities.map(c => c.id === cityId ? {
        ...c,
        projects: c.projects.map(p => p.id === projectId ? {
          ...p, tasks: p.tasks.map(t => t.id === taskId ? { ...t, ...fields } : t),
        } : p),
      } : c),
    })),
    deleteTask: (cityId, projectId, taskId) => update(d => ({
      ...d,
      cities: d.cities.map(c => c.id === cityId ? {
        ...c,
        projects: c.projects.map(p => p.id === projectId ? {
          ...p, tasks: p.tasks.filter(t => t.id !== taskId),
        } : p),
      } : c),
    })),
    reorderTasks: (cityId, projectId, fromIdx, toIdx) => update(d => ({
      ...d,
      cities: d.cities.map(c => c.id === cityId ? {
        ...c,
        projects: c.projects.map(p => {
          if (p.id !== projectId) return p;
          const next = [...p.tasks];
          const [moved] = next.splice(fromIdx, 1);
          next.splice(toIdx, 0, moved);
          return { ...p, tasks: next };
        }),
      } : c),
    })),

    // DATA
    replaceAll: (newData) => setData(window.TM.migrate(newData)),
    resetSeed: () => setData(JSON.parse(JSON.stringify(window.TM.SEED))),
    clearAll: () => setData({ areas: [], cities: [] }),
  }), [update]);

  return [data, actions];
}

// ─── derived helpers ──────────────────────────────────────────
// Pseudo-area for clients that aren't assigned to any (existing) area.
const UNASSIGNED_AREA = { id: "__none", name: "ללא תחום", visibility: "shared", owner: null, isUnassigned: true };

// What this user may see, as a tree: [{ area, clients: [{ city, projects }] }].
// Anything private at any level (area / client / project) is shown only to its owner.
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

// Open tasks for the dashboard TODO list, one group per area. Dated tasks are
// ranked by urgency; undated ones are only summarized per project.
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

function findArea(data, areaId) {
  if (areaId === UNASSIGNED_AREA.id) return UNASSIGNED_AREA;
  return data.areas.find(a => a.id === areaId) || null;
}
// The area a client belongs to (UNASSIGNED_AREA if none / deleted).
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

// ─── hash routing ────────────────────────────────────────────
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
  findArea, areaOf, findCity, findProject,
});
