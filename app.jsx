// app.jsx — root: auth gate, sign-in screen, install button, status indicator,
// route dispatch, tweaks panel, import/export.

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#1e40af",
  "density": "regular",
  "layout": "grid"
}/*EDITMODE-END*/;

const ACCENT_MAP = {
  "#1e40af": "blue",
  "#0f766e": "teal",
  "#b45309": "amber",
  "#1f2937": "graphite",
};

// ─── Sign-in screen ──────────────────────────────────────────
function SignInScreen({ onSignIn }) {
  return (
    <div className="signin">
      <div className="signin-card">
        <div className="signin-mark">מ</div>
        <h1>מנהל פרויקטים</h1>
        <p>התחבר כדי לסנכרן את הנתונים שלך עם הצוות, בין המכשירים, באופן מיידי.</p>
        <button className="btn-google" onClick={onSignIn}>
          <svg width="18" height="18" viewBox="0 0 48 48">
            <path fill="#FFC107" d="M43.6 20.5H42V20.4H24v7.2h11.3c-1.6 4.5-5.8 7.7-11.3 7.7-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.7 1.1 7.8 3l5.1-5.1C33.5 6.3 28.9 4.4 24 4.4 13.2 4.4 4.4 13.2 4.4 24S13.2 43.6 24 43.6 43.6 34.8 43.6 24c0-1.2-.1-2.4-.4-3.5z"/>
            <path fill="#FF3D00" d="M6.3 14.7l5.9 4.3C13.8 14.7 18.5 11.6 24 11.6c3 0 5.7 1.1 7.8 3l5.1-5.1C33.5 6.3 28.9 4.4 24 4.4 16.4 4.4 9.9 8.7 6.3 14.7z"/>
            <path fill="#4CAF50" d="M24 43.6c4.9 0 9.3-1.8 12.7-4.9l-5.9-5c-1.9 1.4-4.4 2.3-6.8 2.3-5.5 0-10.1-3.7-11.7-8.7l-5.9 4.5C9.7 38.6 16.4 43.6 24 43.6z"/>
            <path fill="#1976D2" d="M43.6 20.5H42V20.4H24v7.2h11.3c-.8 2.2-2.1 4-3.9 5.3l5.9 5c4.2-3.9 6.7-9.7 6.7-16.4 0-1.2-.1-2.4-.4-3.5z"/>
          </svg>
          <span>התחבר עם Google</span>
        </button>
        <p className="signin-hint">
          רק חברי הצוות המורשים יוכלו לגשת לנתונים.
        </p>
      </div>
    </div>
  );
}

// ─── Loading splash ──────────────────────────────────────────
function Splash() {
  return (
    <div className="signin">
      <div className="signin-card" style={{ textAlign: "center" }}>
        <div className="signin-mark">מ</div>
        <p style={{ color: "var(--ink-3)" }}>טוען…</p>
      </div>
    </div>
  );
}

// ─── Status pill (synced / saving / offline / local) ─────────
function CloudBadge({ cloud, installPrompt, onInstall }) {
  let label, color;
  if (window.IS_DEV)          { label = "תצוגה מקדימה — נתוני דוגמה", color = "#7c3aed"; }
  else if (cloud.mode === "local") { label = "מצב מקומי", color = "#64748b"; }
  else if (cloud.status === "saving")  { label = "שומר…",   color = "#d97706"; }
  else if (cloud.status === "error")   { label = "שגיאה",   color = "#b91c1c"; }
  else                                  { label = "מסונכרן", color = "#15803d"; }
  return (
    <div className="cloud-badge">
      <span className="cb-dot" style={{ background: color }} />
      <span className="cb-label">{label}</span>
      {cloud.user && (
        <>
          <span className="cb-sep" />
          {cloud.user.photoURL
            ? <img className="cb-avatar" src={cloud.user.photoURL} alt="" />
            : <span className="cb-avatar cb-avatar-fallback">
                {(cloud.user.name || cloud.user.email || "?").slice(0,1).toUpperCase()}
              </span>}
          <span className="cb-name" title={cloud.user.email}>
            {cloud.user.name || cloud.user.email}
          </span>
          {!window.IS_DEV && (
            <button className="cb-action" onClick={cloud.signOut} title="התנתק">יציאה</button>
          )}
        </>
      )}
      {installPrompt && (
        <>
          <span className="cb-sep" />
          <button className="cb-action cb-action-primary" onClick={onInstall}>התקן כאפליקציה</button>
        </>
      )}
    </div>
  );
}

// ─── Workspace (the actual app) ──────────────────────────────
function Workspace({ cloud, installPrompt, onInstall }) {
  const [data, actions] = window.useStore(cloud);
  const route = window.useRoute();
  const [search, setSearch] = React.useState("");
  const [t, setTweak] = window.useTweaks(TWEAK_DEFAULTS);
  const fileInputRef = React.useRef(null);

  React.useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-accent", ACCENT_MAP[t.accent] || "blue");
    root.setAttribute("data-density", t.density);
    root.setAttribute("data-layout", t.layout);
  }, [t.accent, t.density, t.layout]);

  // Cloud data still loading?
  if (cloud.mode === "signedIn" && data === null) {
    return <Splash />;
  }

  // ── export / import ──
  const onExport = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const ts = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    a.href = url;
    a.download = `task-manager-${ts}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  };
  const onImport = () => fileInputRef.current?.click();
  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || !Array.isArray(parsed.cities)) throw new Error("invalid");
        actions.replaceAll(parsed);
        alert("הנתונים יובאו בהצלחה.");
      } catch (err) {
        alert("שגיאה בקריאת הקובץ.");
      }
    };
    reader.readAsText(f);
    e.target.value = "";
  };

  // ── route dispatch ──
  let body;
  if (route.view === "area")
    body = <window.AreaView data={data} actions={actions} search={search}
            areaId={route.areaId} userEmail={cloud.user?.email} />;
  else if (route.view === "city")
    body = <window.CityView data={data} actions={actions} search={search}
            cityId={route.cityId} userEmail={cloud.user?.email} />;
  else if (route.view === "project")
    body = <window.ProjectView data={data} actions={actions} search={search}
            cityId={route.cityId} projectId={route.projectId} userEmail={cloud.user?.email} />;
  else
    body = <window.DashboardView data={data} actions={actions} search={search}
            userEmail={cloud.user?.email} />;

  return (
    <div className="app">
      <CloudBadge cloud={cloud} installPrompt={installPrompt} onInstall={onInstall} />
      <window.TopBar search={search} onSearchChange={setSearch} />
      {body}

      <footer className="data-tools">
        <span>
          {cloud.mode === "signedIn"
            ? "הנתונים מסונכרנים בענן (Firestore)"
            : "הנתונים נשמרים במכשיר זה (localStorage)"}
        </span>
        <span className="spacer" />
        <button className="btn btn-sm" onClick={onExport}>{window.Icon.download}<span>ייצוא JSON</span></button>
        <button className="btn btn-sm" onClick={onImport}>{window.Icon.upload}<span>ייבוא JSON</span></button>
        {cloud.mode === "local" && (
          <button className="btn btn-sm" onClick={() => {
            if (confirm("לאפס לנתוני הדוגמה? כל השינויים יימחקו.")) actions.resetSeed();
          }}>{window.Icon.refresh}<span>איפוס לדוגמה</span></button>
        )}
        <input ref={fileInputRef} type="file" accept="application/json,.json"
          style={{ display: "none" }} onChange={onFile} />
      </footer>

      <window.TweaksPanel>
        <window.TweakSection label="מראה" />
        <window.TweakColor
          label="צבע מבטא"
          value={t.accent}
          options={["#1e40af", "#0f766e", "#b45309", "#1f2937"]}
          onChange={(v) => setTweak("accent", v)}
        />
        <window.TweakRadio
          label="צפיפות"
          value={t.density}
          options={["compact", "regular"]}
          onChange={(v) => setTweak("density", v)}
        />
        <window.TweakRadio
          label="פריסת כרטיסים"
          value={t.layout}
          options={["grid", "list"]}
          onChange={(v) => setTweak("layout", v)}
        />
      </window.TweaksPanel>
    </div>
  );
}

// ─── Root: branches on cloud auth state ──────────────────────
function App() {
  const cloud = window.useCloud();

  // PWA install prompt capture
  const [installPrompt, setInstallPrompt] = React.useState(null);
  React.useEffect(() => {
    const onBip = (e) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener("beforeinstallprompt", onBip);
    return () => window.removeEventListener("beforeinstallprompt", onBip);
  }, []);
  const doInstall = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  if (cloud.mode === "loading") return <Splash />;
  if (cloud.mode === "signedOut") return <SignInScreen onSignIn={cloud.signIn} />;
  return <Workspace cloud={cloud} installPrompt={installPrompt} onInstall={doInstall} />;
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
