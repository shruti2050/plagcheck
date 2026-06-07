import { useState, useRef, useEffect, useCallback } from "react";

const API = "http://localhost:8000";

// ── Utilities ─────────────────────────────────────────────────────────────────

function wordCount(text) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function fmt(n) {
  return n?.toLocaleString() ?? "0";
}

function timeAgo(iso) {
  const d = new Date(iso);
  const diff = (Date.now() - d) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return d.toLocaleDateString();
}

const VERDICT_COLORS = {
  green:  { ring: "#1D9E75", bg: "#E1F5EE", text: "#0F6E56" },
  teal:   { ring: "#1D9E75", bg: "#E1F5EE", text: "#0F6E56" },
  yellow: { ring: "#BA7517", bg: "#FAEEDA", text: "#854F0B" },
  orange: { ring: "#D85A30", bg: "#FAECE7", text: "#993C1D" },
  red:    { ring: "#E24B4A", bg: "#FCEBEB", text: "#A32D2D" },
};

// ── Components ────────────────────────────────────────────────────────────────

function Spinner({ size = 32, color = "#0F6E56" }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      border: `${size / 12}px solid #e5e7eb`,
      borderTopColor: color,
      animation: "spin 0.75s linear infinite",
    }} />
  );
}

function ScoreRing({ score = 0, color = "#1D9E75", size = 100 }) {
  const r = (size / 2) - 8;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#f0f0f0" strokeWidth={size/12} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color}
          strokeWidth={size/12} strokeLinecap="round"
          strokeDasharray={circ.toFixed(1)} strokeDashoffset={offset.toFixed(1)}
          style={{ transition: "stroke-dashoffset 1s ease" }} />
      </svg>
      <div style={{
        position: "absolute", inset: 0,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center"
      }}>
        <span style={{ fontSize: size * 0.26, fontWeight: 600, color, lineHeight: 1 }}>{score}</span>
        <span style={{ fontSize: size * 0.12, color: "#9ca3af", marginTop: 2 }}>/ 100</span>
      </div>
    </div>
  );
}

function ProgressBar({ pct, color = "#0F6E56", label }) {
  return (
    <div style={{ marginBottom: 12 }}>
      {label && <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: "#6b7280" }}>{label}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color }}>{Math.round(pct)}%</span>
      </div>}
      <div style={{ height: 6, background: "#f3f4f6", borderRadius: 3, overflow: "hidden" }}>
        <div style={{
          height: "100%", width: `${pct}%`, background: color, borderRadius: 3,
          transition: "width 0.8s ease"
        }} />
      </div>
    </div>
  );
}

function Badge({ type }) {
  const styles = {
    web: { bg: "#E1F5EE", color: "#0F6E56" },
    academic: { bg: "#E6F1FB", color: "#185FA5" },
    book: { bg: "#EEEDFE", color: "#534AB7" },
  };
  const s = styles[type] || styles.web;
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 20,
      background: s.bg, color: s.color, textTransform: "uppercase", letterSpacing: "0.05em"
    }}>{type}</span>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [tab, setTab] = useState("checker");
  const [text, setText] = useState("");
  const [title, setTitle] = useState("Untitled Document");
  const [phase, setPhase] = useState("idle"); // idle | checking | done | error
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState("");
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState("");
  const [sensitivity, setSensitivity] = useState(25);
  const [settings, setSettings] = useState({ web: true, academic: true, books: false });
  const [apiStatus, setApiStatus] = useState("unknown");
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef();
  const abortRef = useRef();

  const wc = wordCount(text);

  // Check API health on mount
  useEffect(() => {
    fetch(`${API}/health`)
      .then(r => r.json())
      .then(d => setApiStatus(d.ollama))
      .catch(() => setApiStatus("offline"));
  }, []);

  // Load history
  useEffect(() => {
    if (tab === "history") loadHistory();
  }, [tab]);

  const loadHistory = async () => {
    try {
      const r = await fetch(`${API}/api/checks/history?user_id=anonymous&limit=50`);
      const data = await r.json();
      setHistory(data);
    } catch {
      setHistory([]);
    }
  };

  const runCheck = useCallback(async () => {
    if (!text.trim() || wc < 50) return;
    setPhase("checking");
    setProgress(0);
    setProgressMsg("Starting analysis...");
    setResult(null);
    setError("");

    try {
      const res = await fetch(`${API}/api/check/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text, title, user_id: "anonymous",
          sensitivity, check_web: settings.web, check_academic: settings.academic
        }),
        signal: abortRef.current?.signal
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === "progress" || evt.type === "phase") {
              setProgress(evt.pct || Math.round((evt.chunk / evt.total) * 80));
              setProgressMsg(evt.message || "Analyzing...");
            }
            if (evt.type === "complete") {
              setResult(evt.result);
              setPhase("done");
              setProgress(100);
            }
          } catch {}
        }
      }
    } catch (e) {
      if (e.name !== "AbortError") {
        setError("Analysis failed. Make sure the backend is running on port 8000.");
        setPhase("error");
      }
    }
  }, [text, title, sensitivity, settings, wc]);

  const handleUpload = async (file) => {
    const form = new FormData();
    form.append("file", file);
    try {
      const r = await fetch(`${API}/api/upload`, { method: "POST", body: form });
      const data = await r.json();
      setText(data.text);
      setTitle(file.name.replace(/\.[^.]+$/, ""));
    } catch {
      setError("Upload failed. Check file format (.txt, .pdf, .docx)");
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleUpload(file);
  };

  const exportReport = () => {
    if (!result) return;
    const txt = `PLAGIARISM REPORT — PlagCheck SaaS
Generated: ${new Date().toLocaleString()}
Document: ${title}

═══════════════════════════════════════
ORIGINALITY SCORE: ${result.originality_score}/100
VERDICT: ${result.verdict}
PLAGIARISM: ${result.plagiarism_percentage}%
WORD COUNT: ${fmt(result.word_count)}
SOURCES FOUND: ${result.sources_found}
FLAGGED PHRASES: ${result.flagged_phrases}
CHUNKS ANALYZED: ${result.chunks_analyzed}
ANALYSIS METHOD: ${result.analysis_method}
═══════════════════════════════════════

SUMMARY:
${result.summary}

MATCHED SOURCES:
${(result.sources || []).map(s => `  [${s.type.toUpperCase()}] ${s.title} — ${s.similarity}% match\n  ${s.url}`).join("\n")}

FLAGGED PASSAGES:
${(result.highlighted_passages || []).map(p => `  [${p.severity.toUpperCase()}] "${p.text}"\n  → ${p.source}`).join("\n\n")}

RECOMMENDATIONS:
${(result.suggestions || []).map(s => `  ${s.type === "warning" ? "⚠" : "✓"} ${s.text}`).join("\n")}
`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([txt], { type: "text/plain" }));
    a.download = `plagcheck-${title.replace(/\s+/g, "-")}.txt`;
    a.click();
  };

  // Styles
  const s = {
    app: { display: "flex", flexDirection: "column", height: "100vh", background: "#f9fafb", fontFamily: "'IBM Plex Sans', 'Segoe UI', sans-serif" },
    topbar: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 24px", height: 56, background: "#fff", borderBottom: "1px solid #e5e7eb", flexShrink: 0 },
    logo: { display: "flex", alignItems: "center", gap: 10, fontWeight: 700, fontSize: 16, color: "#111827", letterSpacing: "-0.02em" },
    logoMark: { width: 32, height: 32, borderRadius: 8, background: "#0F6E56", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 16, fontWeight: 700 },
    main: { display: "grid", gridTemplateColumns: "1fr 400px", flex: 1, overflow: "hidden" },
    panel: { display: "flex", flexDirection: "column", overflow: "hidden", background: "#fff", borderRight: "1px solid #e5e7eb" },
    panelHead: { padding: "12px 20px", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, background: "#fff" },
    panelLabel: { fontSize: 11, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.08em" },
    results: { display: "flex", flexDirection: "column", overflow: "hidden", background: "#fff" },
    scrollable: { flex: 1, overflowY: "auto", padding: "16px 20px" },
    btn: (bg = "#0F6E56", color = "#fff") => ({
      background: bg, color, border: "none", borderRadius: 8, padding: "10px 18px",
      fontSize: 14, fontWeight: 600, cursor: "pointer", transition: "all 0.15s"
    }),
    ghostBtn: { background: "transparent", border: "1px solid #e5e7eb", borderRadius: 6, padding: "4px 12px", fontSize: 12, cursor: "pointer", color: "#6b7280", transition: "all 0.1s" },
    sectionHead: { fontSize: 11, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.08em", margin: "16px 0 8px" },
    card: { border: "1px solid #e5e7eb", borderRadius: 10, padding: "12px 14px", marginBottom: 8 },
    metricCard: { background: "#f9fafb", borderRadius: 8, padding: "10px 14px", flex: 1 },
  };

  const navTabs = ["checker", "history", "settings"];
  const vc = VERDICT_COLORS[result?.verdict_color] || VERDICT_COLORS.green;

  return (
    <div style={s.app}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'IBM Plex Sans', sans-serif; }
        textarea { font-family: 'IBM Plex Sans', sans-serif; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        .fade-in { animation: fadeIn 0.3s ease; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #e5e7eb; border-radius: 3px; }
        button:hover { opacity: 0.9; }
      `}</style>

      {/* Topbar */}
      <div style={s.topbar}>
        <div style={s.logo}>
          <div style={s.logoMark}>P</div>
          PlagCheck
          <span style={{ fontSize: 10, background: "#E1F5EE", color: "#0F6E56", padding: "2px 8px", borderRadius: 20, fontWeight: 600, marginLeft: 4 }}>FREE</span>
        </div>

        {/* Nav */}
        <div style={{ display: "flex", background: "#f3f4f6", borderRadius: 8, padding: 3, gap: 2 }}>
          {navTabs.map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: "5px 16px", borderRadius: 6, border: "none", fontSize: 13, cursor: "pointer",
              fontWeight: tab === t ? 600 : 400,
              background: tab === t ? "#fff" : "transparent",
              color: tab === t ? "#111827" : "#6b7280",
              boxShadow: tab === t ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
              transition: "all 0.15s"
            }}>{t.charAt(0).toUpperCase() + t.slice(1)}</button>
          ))}
        </div>

        {/* Status dot */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#6b7280" }}>
          <div style={{
            width: 7, height: 7, borderRadius: "50%",
            background: apiStatus.includes("connected") ? "#1D9E75" : apiStatus === "offline" ? "#E24B4A" : "#BA7517"
          }} />
          {apiStatus.includes("connected") ? "Ollama connected" : apiStatus === "offline" ? "API offline" : "Heuristic mode"}
        </div>
      </div>

      {/* Main */}
      <div style={s.main}>

        {/* LEFT PANEL */}
        {tab === "checker" && (
          <div style={s.panel}>
            {/* Header */}
            <div style={s.panelHead}>
              <input value={title} onChange={e => setTitle(e.target.value)}
                style={{ border: "none", outline: "none", fontSize: 14, fontWeight: 600, color: "#111827", flex: 1, background: "transparent" }}
                placeholder="Document title" />
              <div style={{ display: "flex", gap: 6 }}>
                <button style={s.ghostBtn} onClick={() => fileRef.current.click()}>Upload file</button>
                <button style={s.ghostBtn} onClick={() => { setText(""); setPhase("idle"); setResult(null); }}>Clear</button>
              </div>
              <input ref={fileRef} type="file" accept=".txt,.pdf,.docx" style={{ display: "none" }}
                onChange={e => e.target.files[0] && handleUpload(e.target.files[0])} />
            </div>

            {/* Editor */}
            <div style={{ flex: 1, position: "relative" }}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}>
              <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder="Paste your essay, research paper, thesis, or dissertation here…

Supports up to 200,000 words. You can also upload .txt, .pdf, or .docx files."
                style={{
                  width: "100%", height: "100%", resize: "none",
                  border: "none", outline: "none", padding: "20px 24px",
                  fontSize: 15, lineHeight: 1.8, color: "#111827",
                  background: dragOver ? "#f0fdf4" : "#fff",
                  transition: "background 0.2s"
                }} />
              {dragOver && (
                <div style={{
                  position: "absolute", inset: 0, background: "rgba(15,110,86,0.08)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  pointerEvents: "none", border: "2px dashed #0F6E56", borderRadius: 4
                }}>
                  <div style={{ fontSize: 16, fontWeight: 600, color: "#0F6E56" }}>Drop file to upload</div>
                </div>
              )}
            </div>

            {/* Footer bar */}
            <div style={{ padding: "8px 24px", borderTop: "1px solid #e5e7eb", display: "flex", alignItems: "center", gap: 16, flexShrink: 0, background: "#fafafa" }}>
              <span style={{ fontSize: 12, color: wc > 200000 ? "#E24B4A" : "#6b7280" }}>{fmt(wc)} words</span>
              <span style={{ fontSize: 12, color: "#d1d5db" }}>•</span>
              <span style={{ fontSize: 12, color: "#6b7280" }}>{fmt(text.length)} chars</span>
              {wc > 0 && wc < 50 && <span style={{ fontSize: 12, color: "#D85A30" }}>⚠ min 50 words</span>}
              {wc > 200000 && <span style={{ fontSize: 12, color: "#E24B4A" }}>⚠ exceeds 200k limit</span>}
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 12, color: "#6b7280" }}>~{Math.max(5, Math.round(wc / 500))}s estimate</span>
            </div>

            {error && (
              <div style={{ margin: "0 16px 8px", padding: "8px 12px", background: "#FCEBEB", color: "#A32D2D", borderRadius: 8, fontSize: 13 }}>
                ⚠ {error}
              </div>
            )}

            {/* Check button */}
            <button
              onClick={runCheck}
              disabled={phase === "checking" || wc < 50 || wc > 200000}
              style={{
                ...s.btn("#0F6E56"),
                margin: "0 16px 16px",
                padding: "13px",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                opacity: (phase === "checking" || wc < 50) ? 0.5 : 1,
                cursor: (phase === "checking" || wc < 50) ? "not-allowed" : "pointer",
                fontSize: 15
              }}>
              {phase === "checking" ? <Spinner size={18} color="#fff" /> : "✦"}
              {phase === "checking" ? progressMsg : "Check for plagiarism"}
            </button>
          </div>
        )}

        {tab === "history" && (
          <div style={s.panel}>
            <div style={s.panelHead}>
              <span style={s.panelLabel}>Check history</span>
              <button style={s.ghostBtn} onClick={loadHistory}>Refresh</button>
            </div>
            <div style={s.scrollable}>
              {history.length === 0 ? (
                <div style={{ textAlign: "center", padding: "60px 20px", color: "#9ca3af" }}>
                  <div style={{ fontSize: 36, marginBottom: 12 }}>◎</div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "#6b7280" }}>No checks yet</div>
                  <div style={{ fontSize: 13, marginTop: 4 }}>Run your first plagiarism check to see history here.</div>
                </div>
              ) : history.map(h => {
                const c = h.originality_score >= 80 ? VERDICT_COLORS.green : h.originality_score >= 60 ? VERDICT_COLORS.yellow : VERDICT_COLORS.red;
                return (
                  <div key={h.id} className="fade-in" style={{ ...s.card, cursor: "pointer" }}
                    onClick={() => { setTab("checker"); }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, color: "#111827" }}>{h.title || "Untitled"}</div>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 10px", borderRadius: 20, background: c.bg, color: c.text, flexShrink: 0, marginLeft: 8 }}>
                        {h.originality_score}% original
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 12, fontSize: 12, color: "#6b7280" }}>
                      <span>{fmt(h.word_count)} words</span>
                      <span>•</span>
                      <span>{h.plagiarism_pct}% similarity</span>
                      <span>•</span>
                      <span>{timeAgo(h.created_at)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {tab === "settings" && (
          <div style={s.panel}>
            <div style={s.panelHead}>
              <span style={s.panelLabel}>Settings</span>
            </div>
            <div style={s.scrollable}>
              {/* API config */}
              <div style={s.sectionHead}>Backend</div>
              <div style={s.card}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Ollama model</div>
                <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>Model running via Ollama locally. Change in .env file.</div>
                <div style={{ fontSize: 12, fontFamily: "monospace", background: "#f3f4f6", padding: "6px 10px", borderRadius: 6 }}>OLLAMA_MODEL=mistral</div>
              </div>
              <div style={s.card}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>API endpoint</div>
                <div style={{ fontSize: 12, fontFamily: "monospace", background: "#f3f4f6", padding: "6px 10px", borderRadius: 6 }}>{API}</div>
              </div>

              {/* Sensitivity */}
              <div style={s.sectionHead}>Detection sensitivity</div>
              <div style={s.card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 13 }}>Threshold</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#0F6E56" }}>{sensitivity}%</span>
                </div>
                <input type="range" min="5" max="80" step="5" value={sensitivity}
                  onChange={e => setSensitivity(+e.target.value)} style={{ width: "100%" }} />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#9ca3af", marginTop: 4 }}>
                  <span>Strict (5%)</span><span>Lenient (80%)</span>
                </div>
              </div>

              {/* Source types */}
              <div style={s.sectionHead}>Source types</div>
              {Object.entries(settings).map(([k, v]) => (
                <div key={k} style={{ ...s.card, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, textTransform: "capitalize" }}>{k === "academic" ? "Academic databases" : k === "web" ? "Web sources" : "Books & publications"}</div>
                    <div style={{ fontSize: 12, color: "#6b7280" }}>{k === "academic" ? "JSTOR, PubMed, arXiv" : k === "web" ? "Wikipedia, news, blogs" : "Google Books, OpenLibrary"}</div>
                  </div>
                  <div onClick={() => setSettings(prev => ({ ...prev, [k]: !prev[k] }))}
                    style={{ width: 40, height: 22, borderRadius: 11, background: v ? "#0F6E56" : "#e5e7eb", position: "relative", cursor: "pointer", transition: "background 0.2s", flexShrink: 0 }}>
                    <div style={{ position: "absolute", top: 2, left: v ? 20 : 2, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
                  </div>
                </div>
              ))}

              {/* Install guide */}
              <div style={s.sectionHead}>Quick setup</div>
              <div style={{ ...s.card, background: "#f9fafb" }}>
                <div style={{ fontSize: 12, color: "#374151", lineHeight: 1.8, fontFamily: "monospace" }}>
                  {"# 1. Install Ollama"}<br />
                  {"curl https://ollama.ai/install.sh | sh"}<br /><br />
                  {"# 2. Pull a model (free)"}<br />
                  {"ollama pull mistral"}<br /><br />
                  {"# 3. Start backend"}<br />
                  {"cd backend && pip install -r requirements.txt"}<br />
                  {"uvicorn main:app --reload"}<br /><br />
                  {"# 4. Start frontend"}<br />
                  {"cd frontend && npm install && npm run dev"}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* RIGHT PANEL — Results */}
        <div style={s.results}>
          <div style={s.panelHead}>
            <span style={s.panelLabel}>Analysis results</span>
            {result && (
              <button style={s.ghostBtn} onClick={exportReport}>Export .txt</button>
            )}
          </div>

          {/* Progress during check */}
          {phase === "checking" && (
            <div style={{ padding: "0 20px", paddingTop: 16, flexShrink: 0 }}>
              <ProgressBar pct={progress} label={progressMsg} />
            </div>
          )}

          {/* Empty state */}
          {phase === "idle" && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "2rem", textAlign: "center", color: "#9ca3af" }}>
              <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>◎</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: "#6b7280", marginBottom: 6 }}>Ready to check</div>
              <div style={{ fontSize: 13, lineHeight: 1.6, maxWidth: 280 }}>Supports up to 200,000 words. Uses local AI — no data sent to third parties.</div>
            </div>
          )}

          {/* Error state */}
          {phase === "error" && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "2rem", textAlign: "center" }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>⚠</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#374151", marginBottom: 6 }}>Analysis failed</div>
              <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 16 }}>{error || "Make sure the backend is running."}</div>
              <button style={s.btn()} onClick={runCheck}>Try again</button>
            </div>
          )}

          {/* Loading skeleton */}
          {phase === "checking" && !result && (
            <div style={s.scrollable}>
              {[100, 70, 85, 60].map((w, i) => (
                <div key={i} style={{ height: 16, background: "#f3f4f6", borderRadius: 8, marginBottom: 12, width: `${w}%`, animation: `fadeIn ${0.5 + i * 0.1}s ease` }} />
              ))}
            </div>
          )}

          {/* Results */}
          {result && (
            <div style={{ flex: 1, overflowY: "auto" }} className="fade-in">
              {/* Score header */}
              <div style={{ padding: "16px 20px", borderBottom: "1px solid #e5e7eb" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 14 }}>
                  <ScoreRing score={result.originality_score} color={vc.ring} size={90} />
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: vc.text, marginBottom: 4 }}>{result.verdict}</div>
                    <div style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.6, maxWidth: 240 }}>{result.summary}</div>
                  </div>
                </div>

                {/* Metrics */}
                <div style={{ display: "flex", gap: 8 }}>
                  {[
                    { val: `${result.plagiarism_percentage}%`, lbl: "Similarity", color: vc.text },
                    { val: result.sources_found, lbl: "Sources", color: "#374151" },
                    { val: result.flagged_phrases, lbl: "Flagged", color: "#374151" },
                    { val: fmt(result.word_count), lbl: "Words", color: "#374151" },
                  ].map(m => (
                    <div key={m.lbl} style={s.metricCard}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: m.color }}>{m.val}</div>
                      <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>{m.lbl}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Sources */}
              <div style={{ padding: "0 20px" }}>
                {result.sources?.length > 0 && (
                  <>
                    <div style={s.sectionHead}>Matched sources</div>
                    {result.sources.map((src, i) => (
                      <div key={i} style={s.card}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                          <Badge type={src.type} />
                          <span style={{ fontSize: 16, fontWeight: 700, color: "#0F6E56" }}>{src.similarity}%</span>
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#111827", marginBottom: 2 }}>{src.title}</div>
                        <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{src.url}</div>
                        <ProgressBar pct={Math.min(src.similarity * 2.5, 100)} color={src.type === "web" ? "#1D9E75" : src.type === "academic" ? "#185FA5" : "#534AB7"} />
                      </div>
                    ))}
                  </>
                )}

                {result.highlighted_passages?.length > 0 && (
                  <>
                    <div style={s.sectionHead}>Flagged passages</div>
                    {result.highlighted_passages.map((p, i) => {
                      const c = { high: "#A32D2D", medium: "#854F0B", low: "#185FA5" }[p.severity] || "#185FA5";
                      return (
                        <div key={i} style={{ borderLeft: `3px solid ${c}`, paddingLeft: 12, marginBottom: 10, background: "#fafafa", borderRadius: "0 8px 8px 0", padding: "8px 12px" }}>
                          <div style={{ fontSize: 13, color: "#374151", fontStyle: "italic", lineHeight: 1.6 }}>"{p.text}"</div>
                          <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>→ {p.source}</div>
                        </div>
                      );
                    })}
                  </>
                )}

                {result.suggestions?.length > 0 && (
                  <>
                    <div style={s.sectionHead}>Recommendations</div>
                    {result.suggestions.map((s, i) => (
                      <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "8px 0", borderBottom: "1px solid #f3f4f6" }}>
                        <div style={{
                          width: 20, height: 20, borderRadius: "50%", flexShrink: 0, marginTop: 1,
                          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700,
                          background: s.type === "warning" ? "#FAEEDA" : "#EAF3DE",
                          color: s.type === "warning" ? "#854F0B" : "#3B6D11"
                        }}>{s.type === "warning" ? "!" : "✓"}</div>
                        <div style={{ fontSize: 13, color: "#4b5563", lineHeight: 1.6 }}>{s.text}</div>
                      </div>
                    ))}
                  </>
                )}

                <div style={{ height: 24 }} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
