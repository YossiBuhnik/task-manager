// store.jsx — state management + actions + hash routing
// Loaded as Babel script; depends on data.js (window.TM) and React.

const STORAGE_KEY = "tm_data_v1";

function loadInitial() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
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
      setData(cloud.data);
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
    // CITY
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
    addProject: (cityId, name, summary, withStandardTasks) => update(d => ({
      ...d,
      cities: d.cities.map(c => c.id === cityId ? {
        ...c,
        projects: [...c.projects, {
          ...window.TM.newProject(name, summary),
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
    replaceAll: (newData) => setData(newData),
    resetSeed: () => setData(JSON.parse(JSON.stringify(window.TM.SEED))),
    clearAll: () => setData({ cities: [] }),
  }), [update]);

  return [data, actions];
}

// ─── derived helpers ──────────────────────────────────────────
function summarize(data) {
  let projects = 0, tasks = 0, doneTasks = 0, doingTasks = 0;
  let weightedSum = 0;
  for (const c of data.cities) {
    for (const p of c.projects) {
      projects++;
      for (const t of p.tasks) {
        tasks++;
        const w = window.TM.STATUS_BY_KEY[t.status]?.weight ?? 0;
        weightedSum += w;
        if (t.status === "done") doneTasks++;
        if (t.status === "doing") doingTasks++;
      }
    }
  }
  const overall = tasks ? Math.round((weightedSum / tasks) * 100) : 0;
  return {
    cities: data.cities.length,
    projects, tasks, doneTasks, doingTasks,
    overall,
  };
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

Object.assign(window, { useStore, useRoute, go, summarize, findCity, findProject });
