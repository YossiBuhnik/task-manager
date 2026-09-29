// data.js — seed data, standard task templates, pure helpers
// Loaded as a plain <script>, exposes globals: TM (namespace)

(function () {
  const STANDARD_TASKS = [
    "סיור בשטח לבד",
    "סיור עם נציגי העירייה הרלוונטים",
    "פתיחת בקשה לתיאום הנדסי",
    "הסדרי תנועה",
    "התאמה תוכנית עבודה לשטח",
    'בניית לו"ז',
    "קבלת/בניית אומדנים לפרויקט",
    "סיור עם הקבלן בשטח",
    "קידום רישיון",
    'בקשה לפתיחת פק"ע',
  ];

  const STATUSES = [
    { key: "todo",  label: "לא התחיל",  weight: 0,   pill: "pill-todo" },
    { key: "doing", label: "בתהליך",    weight: 0.5, pill: "pill-doing" },
    { key: "done",  label: "הושלם",     weight: 1,   pill: "pill-done" },
  ];
  const STATUS_BY_KEY = Object.fromEntries(STATUSES.map(s => [s.key, s]));

  const PRIORITIES = [
    { key: "high", label: "גבוהה",  cls: "prio-high" },
    { key: "mid",  label: "בינונית", cls: "prio-mid"  },
    { key: "low",  label: "נמוכה",   cls: "prio-low"  },
  ];
  const PRIORITY_BY_KEY = Object.fromEntries(PRIORITIES.map(p => [p.key, p]));

  // ─── id helper ──────────────────────────────────────────────
  const uid = (p = "id") =>
    p + "_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

  // ─── date helpers ───────────────────────────────────────────
  const toDateInput = (d) => {
    if (!d) return "";
    const dt = new Date(d);
    if (isNaN(dt)) return "";
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const day = String(dt.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  const formatHeDate = (d) => {
    if (!d) return "";
    const dt = new Date(d);
    if (isNaN(dt)) return "";
    return dt.toLocaleDateString("he-IL", { day: "numeric", month: "short", year: "numeric" });
  };

  const daysUntil = (d) => {
    if (!d) return null;
    const dt = new Date(d);
    if (isNaN(dt)) return null;
    const today = new Date();
    today.setHours(0,0,0,0);
    dt.setHours(0,0,0,0);
    return Math.round((dt - today) / 86400000);
  };

  // ─── progress (weighted) ────────────────────────────────────
  const taskProgress = (task) => (STATUS_BY_KEY[task.status]?.weight ?? 0) * 100;
  const tasksProgress = (tasks) => {
    if (!tasks || tasks.length === 0) return 0;
    const sum = tasks.reduce((a, t) => a + (STATUS_BY_KEY[t.status]?.weight ?? 0), 0);
    return Math.round((sum / tasks.length) * 100);
  };

  // ─── Google Calendar URL (no API key needed) ────────────────
  const calendarUrl = (task, projectName, cityName) => {
    if (!task.due) return null;
    const dt = new Date(task.due);
    if (isNaN(dt)) return null;

    const pad = (n) => String(n).padStart(2, "0");
    const fmtDay = (d) =>
      `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    const fmtTimed = (d) =>
      `${fmtDay(d)}T${pad(d.getHours())}${pad(d.getMinutes())}00`;

    let dates;
    const hasTime = !!task.time && /^\d{1,2}:\d{2}$/.test(task.time);
    if (hasTime) {
      const [hh, mm] = task.time.split(":").map(Number);
      const start = new Date(dt);
      start.setHours(hh, mm, 0, 0);
      const dur = Math.max(5, Math.min(720, Number(task.duration) || 60));
      const end = new Date(start.getTime() + dur * 60000);
      dates = `${fmtTimed(start)}/${fmtTimed(end)}`;
    } else {
      const next = new Date(dt); next.setDate(next.getDate() + 1);
      dates = `${fmtDay(dt)}/${fmtDay(next)}`;
    }

    const title = task.title;
    const details = [
      cityName ? `תחום: ${cityName}` : "",
      projectName ? `פרויקט: ${projectName}` : "",
      task.assignee ? `אחראי: ${task.assignee}` : "",
      task.priority ? `עדיפות: ${PRIORITY_BY_KEY[task.priority]?.label || ""}` : "",
      task.notes ? `\n${task.notes}` : "",
    ].filter(Boolean).join("\n");

    const params = new URLSearchParams({
      action: "TEMPLATE",
      text: title,
      dates,
      details,
      ctz: "Asia/Jerusalem",
    });
    const participants = (task.participants || "").trim();
    if (participants) params.set("add", participants.replace(/\s+/g, ""));
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  };

  // ─── seed data ──────────────────────────────────────────────
  const today = new Date();
  const offset = (days) => { const d = new Date(today); d.setDate(d.getDate() + days); return toDateInput(d); };

  const mkTask = (title, status, due, assignee, priority, notes = "") => ({
    id: uid("t"),
    title, status, due, assignee, priority, notes,
  });

  const mkProject = (name, summary, tasks) => ({
    id: uid("p"),
    name, summary,
    tasks,
  });

  const mkCity = (areaId, name, projects) => ({
    id: uid("c"),
    areaId,
    name,
    projects,
  });

  // ─── תחומים (top level) ─────────────────────────────────────
  // Data model: areas (תחום) → cities (מזמין עבודה) → projects → tasks.
  // Clients are still stored under the historic key "cities" so existing cloud
  // data keeps working; each one points at its area via areaId.
  // The default areas have fixed ids so every device migrates old data the same way.
  const DEFAULT_AREAS = [
    { id: "area_office", name: "משרד",           visibility: "shared", owner: null },
    { id: "area_pm",     name: "ניהול פרויקטים", visibility: "shared", owner: null },
    { id: "area_qa",     name: "הבטחת איכות",    visibility: "shared", owner: null },
  ];

  const SEED = {
    areas: DEFAULT_AREAS,
    cities: [
      mkCity("area_office", "TSK — פנימי", [
        mkProject("הגשת דוח רבעוני", "סגירת רבעון, אסיפת שותפים", [
          mkTask("איסוף נתונים פיננסיים מהנהלת חשבונות", "done",  offset(-5), "דנה לוי",   "high"),
          mkTask("בדיקת תקציב מול ביצוע",                "doing", offset(2),  "דנה לוי",   "high",
            "ממתינים לסגירת חשבוניות ספקים."),
          mkTask("הכנת מצגת לשותפים",                    "todo",  offset(7),  "אבי גרין",  "mid"),
          mkTask("העברת הדוח לרו\"ח",                    "todo",  offset(10), "דנה לוי",   "high"),
          mkTask("חידוש מנוי תוכנות",                      "todo",  offset(-6), "דנה לוי",   "mid"),
          mkTask("סידור ארכיון",                           "todo",  "",         "",          "low"),
        ]),
        mkProject("חידוש ביטוחים", "ביטוח חבות מקצועית + מבנה", [
          mkTask("השוואת הצעות מחיר מ-3 חברות", "doing", offset(4),  "רונית שמש", "high"),
          mkTask("פגישה עם סוכן הביטוח",         "todo",  offset(9),  "רונית שמש", "mid"),
          mkTask("חתימה על הפוליסה",             "todo",  offset(14), "רונית שמש", "high"),
        ]),
        mkProject("גיוס מנהל פרויקטים נוסף", "תגבור צוות לקראת רבעון הבא", [
          mkTask("ניסוח מודעת דרושים", "done",  offset(-8), "אבי גרין", "mid"),
          mkTask("סינון קורות חיים",   "doing", offset(1),  "אבי גרין", "mid"),
          mkTask("סבב ראיונות ראשון",  "todo",  offset(8),  "אבי גרין", "high"),
        ]),
      ]),
      mkCity("area_pm", "עיריית תל אביב", [
        mkProject("תוספת רמזורים — צומת אבן גבירול", "תכנון והקמת רמזור חדש", [
          mkTask(STANDARD_TASKS[0], "done",  offset(-30), "יוסי כהן",  "high"),
          mkTask(STANDARD_TASKS[1], "done",  offset(-25), "יוסי כהן",  "high"),
          mkTask(STANDARD_TASKS[2], "done",  offset(-18), "דנה לוי",   "high"),
          mkTask(STANDARD_TASKS[3], "done",  offset(-10), "דנה לוי",   "high"),
          mkTask(STANDARD_TASKS[4], "doing", offset(4),   "אבי גרין",  "mid"),
          mkTask(STANDARD_TASKS[5], "doing", offset(8),   "אבי גרין",  "mid"),
          mkTask(STANDARD_TASKS[6], "doing", offset(11),  "רונית שמש", "high"),
          mkTask(STANDARD_TASKS[7], "todo",  offset(20),  "יוסי כהן",  "mid"),
          mkTask(STANDARD_TASKS[8], "todo",  offset(28),  "רונית שמש", "low"),
          mkTask(STANDARD_TASKS[9], "todo",  offset(35),  "דנה לוי",   "low"),
        ]),
        mkProject("שדרוג רחוב דיזנגוף", "שלב א׳ — מקטע צפוני", [
          mkTask(STANDARD_TASKS[0], "done",  offset(-14), "דנה לוי",   "high",
            "סיור ראשוני הושלם, צולמו תמונות מצב קיים."),
          mkTask(STANDARD_TASKS[1], "done",  offset(-10), "דנה לוי",   "high"),
          mkTask(STANDARD_TASKS[2], "doing", offset(3),  "יוסי כהן",  "high",
            "בקשה הוגשה, ממתינים לאישור מתכנן התנועה."),
          mkTask(STANDARD_TASKS[3], "doing", offset(7),  "יוסי כהן",  "mid"),
          mkTask(STANDARD_TASKS[4], "todo",  offset(14), "אבי גרין",  "mid"),
          mkTask(STANDARD_TASKS[5], "todo",  offset(18), "אבי גרין",  "mid"),
          mkTask(STANDARD_TASKS[6], "todo",  offset(21), "רונית שמש", "high"),
          mkTask(STANDARD_TASKS[7], "todo",  offset(28), "אבי גרין",  "low"),
          mkTask(STANDARD_TASKS[8], "todo",  offset(35), "רונית שמש", "mid"),
          mkTask(STANDARD_TASKS[9], "todo",  offset(40), "דנה לוי",   "low"),
        ]),
      ]),
      mkCity("area_qa", "חברה כלכלית אשדוד", [
        mkProject("שיפוץ כיכר המייסדים", "החלפת ריצוף ותאורה", [
          mkTask(STANDARD_TASKS[0], "doing", offset(-3), "רונית שמש", "high"),
          mkTask(STANDARD_TASKS[1], "todo",  offset(8),  "רונית שמש", "mid"),
          mkTask(STANDARD_TASKS[2], "todo",  offset(15), "דנה לוי",   "mid"),
          mkTask(STANDARD_TASKS[4], "todo",  offset(22), "אבי גרין",  "low"),
        ]),
        mkProject("שביל אופניים — שדרות הפלמ\"ח", "שלב תכנון מוקדם", [
          mkTask(STANDARD_TASKS[0], "todo", offset(5),  "יוסי כהן",  "mid"),
          mkTask(STANDARD_TASKS[1], "todo", offset(12), "יוסי כהן",  "mid"),
        ]),
      ]),
    ],
  };

  // ─── empty city / project / task factories ──────────────────
  const newArea = (name, { visibility = "shared", owner = null } = {}) =>
    ({ id: uid("a"), name, visibility, owner });
  const newCity = (name, { areaId = null, visibility = "shared", owner = null } = {}) =>
    ({ id: uid("c"), name, areaId, visibility, owner, projects: [] });

  // Old data (before areas existed) → add the default areas. Clients without an
  // area show up under "ללא תחום" until assigned in their edit dialog.
  const migrate = (data) => {
    if (!data || Array.isArray(data.areas)) return data;
    return { ...data, areas: DEFAULT_AREAS.map(a => ({ ...a })) };
  };
  const newProject = (name, summary = "", { visibility = "shared", owner = null } = {}) =>
    ({ id: uid("p"), name, summary, visibility, owner, tasks: [] });

  // Can this user see a תחום / client / project? (private items are shown only to their owner)
  const canSee = (item, email) =>
    !item.visibility || item.visibility === "shared" || !email || item.owner === email;
  const newTask = (title) => ({
    id: uid("t"),
    title,
    status: "todo",
    due: "",
    time: "",
    duration: 60,
    participants: "",
    assignee: "",
    priority: "mid",
    notes: "",
    createdAt: toDateInput(new Date()),
  });
  const standardTasks = () => STANDARD_TASKS.map(t => newTask(t));

  // ─── TODO ranking ───────────────────────────────────────────
  // Higher score = more urgent. Days overdue count 1:1; priority shifts a task
  // by a week either way; every 4 days a task has been waiting adds a day.
  const PRIO_BONUS = { high: 7, mid: 0, low: -7 };
  const todoScore = (task) => {
    const overdue = -daysUntil(task.due);
    const age = task.createdAt ? Math.max(0, -daysUntil(task.createdAt)) : 0;
    return overdue + (PRIO_BONUS[task.priority] ?? 0) + age / 4;
  };

  // ─── per-area color palette (stable, hash-based) ────────────
  const AREA_COLORS = [
    { key: "indigo", bar: "#6366f1", soft: "#eef2ff", ink: "#3730a3" },
    { key: "teal",   bar: "#14b8a6", soft: "#ccfbf1", ink: "#115e59" },
    { key: "ochre",  bar: "#d97706", soft: "#fef3c7", ink: "#92400e" },
    { key: "plum",   bar: "#a855f7", soft: "#f5f3ff", ink: "#6b21a8" },
    { key: "sage",   bar: "#65a30d", soft: "#ecfccb", ink: "#3f6212" },
    { key: "coral",  bar: "#e11d48", soft: "#ffe4e6", ink: "#9f1239" },
    { key: "slate",  bar: "#64748b", soft: "#f1f5f9", ink: "#334155" },
  ];
  const areaColorFor = (id) => {
    const s = String(id || "");
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return AREA_COLORS[Math.abs(h) % AREA_COLORS.length];
  };

  window.TM = {
    STANDARD_TASKS,
    STATUSES, STATUS_BY_KEY,
    PRIORITIES, PRIORITY_BY_KEY,
    AREA_COLORS, areaColorFor,
    SEED,
    uid,
    toDateInput, formatHeDate, daysUntil,
    taskProgress, tasksProgress,
    calendarUrl,
    DEFAULT_AREAS, migrate,
    newArea, newCity, newProject, newTask, standardTasks,
    canSee, todoScore,
  };
})();
