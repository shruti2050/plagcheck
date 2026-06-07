import { useState, useRef, useEffect, useCallback } from "react";

const API = "http://localhost:8000";

// ── Utilities ─────────────────────────────────────────────────────────────────

function wordCount(text) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function fmt(n) {
  return n?.toLocaleString() ?? "0";
}

const VERDICT_COLORS = {
  green:  { ring: "#1D9E75", bg: "#E1F5EE", text: "#0F6E56" },
  teal:   { ring: "#1D9E75", bg: "#E1F5EE", text: "#0F6E56" },
  yellow: { ring: "#BA7517", bg: "#FAEEDA", text: "#854F0B" },
  orange: { ring: "#D85A30", bg: "#FAECE7", text: "#993C1D" },
  red:    { ring: "#E24B4A", bg: "#FCEBEB", text: "#A32D2D" },
};

// ── Components ────────────────────────────────────────────────────────────────

function Spinner({ size = 18, color = "#fff" }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      border: `${Math.max(2, size / 10)}px solid rgba(255,255,255,0.3)`,
      borderTopColor: color,
      animation: "spin 0.75s linear infinite",
      flexShrink: 0,
    }} />
  );
}

function ScoreRing({ score = 0, color = "#1D9E75", size = 90 }) {
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
        <span style={{ fontSize: size * 0.26, fontWeight: 700, color, lineHeight: 1 }}>{score}</span>
        <span style={{ fontSize: size * 0.12, color: "#9ca3af", marginTop: 2 }}>/ 100</span>
      </div>
    </div>
  );
}

function ProgressBar({ pct, label, color = "#0F6E56" }) {
  return (
    <div style={{ marginBottom: 12 }}>
      {label && (
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontSize: 12, color: "#6b7280" }}>{label}</span>
          <span style={{ fontSize: 12, fontWeight: 600, color }}>{Math.round(pct)}%</span>
        </div>
      )}
      <div style={{ height: 6, background: "#f3f4f6", borderRadius: 3, overflow: "hidden" }}>
        <div style={{
          height: "100%", width: `${pct}%`, background: color, borderRadius: 3,
          transition: "width 0.6s ease"
        }} />
      </div>
    </div>
  );
}

function Badge({ type }) {
  const map = {
    web:      { bg: "#E1F5EE", color: "#0F6E56" },
    academic: { bg: "#E6F1FB", color: "#185FA5" },
    book:     { bg: "#EEEDFE", color: "#534AB7" },
  };
  const s = map[type] || map.web;
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20,
      background: s.bg, color: s.color, textTransform: "uppercase", letterSpacing: "0.05em"
    }}>{type}</span>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [tab, setTab]               = useState("checker");
  const [text, setText]             = useState("");
  const [title, setTitle]           = useState("Untitled Document");
  const [phase, setPhase]           = useState("idle"); // idle | checking | done | error
  const [progress, setProgress]     = useState(0);
  const [progressMsg, setProgressMsg] = useState("");
  const [result, setResult]         = useState(null);
  const [error, setError]           = useState("");
  const [sensitivity, setSensitivity] = useState(25);
  const [apiStatus, setApiStatus]   = useState("unknown");
  const [dragOver, setDragOver]     = useState(false);
  const fileRef = useRef();

  const wc = wordCount(text);

  // Check API + Ollama health on mount
  useEffect(() => {
    fetch(`${API}/health`)
      .then(r => r.json())
      .then(d => setApiStatus(d.ollama || "ok"))
      .catch(() => setApiStatus("offline"));
  }, []);

  const runCheck = useCallback(async () => {
    if (!text.trim() || wc < 50 || wc > 200000) return;
    setPhase("checking");
    setProgress(0);
    setProgressMsg("Starting analysis...");
    setResult(null);
    setError("");

    try {
      const res = await fetch(`${API}/api/check/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, title, sensitivity }),   // clean — no user_id, no toggles
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Server error ${res.status}`);
      }

      const reader  = res.body.getReader();
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
              setProgress(evt.pct ?? Math.round((evt.chunk / evt.total) * 80));
              setProgressMsg(evt.message || "Analyzing...");
            }
            if (evt.type === "complete") {
              setResult(evt.result);
              setPhase("done");
              setProgress(100);
            }
          } catch { /* ignore malformed SSE lines */ }
        }
      }
    } catch (e) {
      setError(e.message || "Analysis failed. Make sure the backend is running on port 8000.");
      setPhase("error");
    }
  }, [text, title, sensitivity, wc]);

  const handleUpload = async (file) => {
    const form = new FormData();
    form.append("file", file);
    try {
      const r    = await fetch(`${API}/api/upload`, { method: "POST", body: form });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || "Upload failed");
      setText(data.text);
      setTitle(file.name.replace(/\.[^.]+$/, ""));
    } catch (e) {
      setError(e.message || "Upload failed. Check file format (.txt, .pdf, .docx)");
    }
  };

  const exportReport = () => {
    if (!result) return;
    const r   = result;
    const txt = `PLAGIARISM REPORT — PlagCheck
Generated : ${new Date().toLocaleString()}
Document  : ${title}

══════════════════════════════════════
ORIGINALITY SCORE : ${r.originality_score}/100
VERDICT           : ${r.verdict}
SIMILARITY        : ${r.plagiarism_percentage}%
WORD COUNT        : ${fmt(r.word_count)}
SOURCES FOUND     : ${r.sources_found}
FLAGGED PHRASES   : ${r.flagged_phrases}
CHUNKS ANALYZED   : ${r.chunks_analyzed}
ENGINE            : ${r.analysis_method}
══════════════════════════════════════

SUMMARY:
${r.summary}

MATCHED SOURCES:
${(r.sources || []).map(s => `  [${s.type.toUpperCase()}] ${s.title} — ${s.similarity}% match\n  ${s.url}`).join("\n")}

FLAGGED PASSAGES:
${(r.highlighted_passages || []).map(p => `  [${p.severity.toUpperCase()}] "${p.text}"\n  → ${p.source}`).join("\n\n")}

RECOMMENDATIONS:
${(r.suggestions || []).map(s => `  ${s.type === "warning" ? "⚠" : "✓"} ${s.text}`).join("\n")}
`;
    const a = document.createElement("a");
    a.href     = URL.createObjectURL(new Blob([txt], { type: "text/plain" }));
    a.download = `plagcheck-${title.replace(/\s+/g, "-")}.txt`;
    a.click();
  };

  // ── Shared styles ──────────────────────────────────────────────────────────

  const S = {
    app:        { display: "flex", flexDirection: "column", height: "100vh", background: "#f9fafb", fontFamily: "'IBM Plex Sans', 'Segoe UI', sans-serif" },
    topbar:     { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 24px", height: 56, background: "#fff", borderBottom: "1px solid #e5e7eb", flexShrink: 0 },
    logo:       { display: "flex", alignItems: "center", gap: 10, fontWeight: 700, fontSize: 16, color: "#111827", letterSpacing: "-0.02em" },
    logoMark:   { width: 32, height: 32, borderRadius: 8, background: "#0F6E56", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 16, fontWeight: 700 },
    main:       { display: "grid", gridTemplateColumns: "1fr 400px", flex: 1, overflow: "hidden" },
    panel:      { display: "flex", flexDirection: "column", overflow: "hidden", background: "#fff", borderRight: "1px solid #e5e7eb" },
    panelHead:  { padding: "12px 20px", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 },
    panelLabel: { fontSize: 11, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.08em" },
    results:    { display: "flex", flexDirection: "column", overflow: "hidden", background: "#fff" },
    scroll:     { flex: 1, overflowY: "auto", padding: "16px 20px" },
    btn:        (bg = "#0F6E56", col = "#fff", disabled = false) => ({
      background: disabled ? "#e5e7eb" : bg, color: disabled ? "#9ca3af" : col,
      border: "none", borderRadius: 8, padding: "10px 18px",
      fontSize: 14, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer",
    }),
    ghost:      { background: "transparent", border: "1px solid #e5e7eb", borderRadius: 6, padding: "4px 12px", fontSize: 12, cursor: "pointer", color: "#6b7280" },
    sHead:      { fontSize: 11, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.08em", margin: "16px 0 8px" },
    card:       { border: "1px solid #e5e7eb", borderRadius: 10, padding: "12px 14px", marginBottom: 8 },
    metric:     { background: "#f9fafb", borderRadius: 8, padding: "10px 14px", flex: 1 },
  };

  const vc = VERDICT_COLORS[result?.verdict_color] || VERDICT_COLORS.green;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={S.app}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body, textarea { font-family: 'IBM Plex Sans', sans-serif; }
        @keyframes spin    { to { transform: rotate(360deg); } }
        @keyframes fadeIn  { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        .fade-in { animation: fadeIn 0.3s ease; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-thumb { background: #e5e7eb; border-radius: 3px; }
        button:hover { opacity: 0.88; }
      `}</style>

      {/* ── Topbar ─────────────────────────────────────────────────────────── */}
      <div style={S.topbar}>
        <div style={S.logo}>
          <div style={S.logoMark}>P</div>
          PlagCheck
          <span style={{ fontSize: 10, background: "#E1F5EE", color: "#0F6E56", padding: "2px 8px", borderRadius: 20, fontWeight: 700, marginLeft: 4 }}>
            LOCAL
          </span>
        </div>

        {/* Tab switcher — only Checker + Settings (no History) */}
        <div style={{ display: "flex", background: "#f3f4f6", borderRadius: 8, padding: 3, gap: 2 }}>
          {["checker", "settings"].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: "5px 16px", borderRadius: 6, border: "none", fontSize: 13, cursor: "pointer",
              fontWeight: tab === t ? 600 : 400,
              background: tab === t ? "#fff" : "transparent",
              color: tab === t ? "#111827" : "#6b7280",
              boxShadow: tab === t ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
              transition: "all 0.15s",
            }}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {/* Ollama status dot */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#6b7280" }}>
          <div style={{
            width: 7, height: 7, borderRadius: "50%",
            background: apiStatus.includes("connected") ? "#1D9E75"
                      : apiStatus === "offline"          ? "#E24B4A"
                      : "#BA7517",
          }} />
          {apiStatus.includes("connected") ? "Ollama connected"
            : apiStatus === "offline"      ? "API offline"
            : "Heuristic mode"}
        </div>
      </div>

      {/* ── Main grid ──────────────────────────────────────────────────────── */}
      <div style={S.main}>

        {/* LEFT — Checker */}
        {tab === "checker" && (
          <div style={S.panel}>
            {/* Panel header */}
            <div style={S.panelHead}>
              <input
                value={title} onChange={e => setTitle(e.target.value)}
                placeholder="Document title"
                style={{ border: "none", outline: "none", fontSize: 14, fontWeight: 600, color: "#111827", flex: 1, background: "transparent" }}
              />
              <div style={{ display: "flex", gap: 6 }}>
                <button style={S.ghost} onClick={() => fileRef.current.click()}>Upload file</button>
                <button style={S.ghost} onClick={() => { setText(""); setPhase("idle"); setResult(null); setError(""); }}>Clear</button>
              </div>
              <input ref={fileRef} type="file" accept=".txt,.pdf,.docx" style={{ display: "none" }}
                onChange={e => e.target.files[0] && handleUpload(e.target.files[0])} />
            </div>

            {/* Text editor with drag & drop */}
            <div style={{ flex: 1, position: "relative" }}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); e.dataTransfer.files[0] && handleUpload(e.dataTransfer.files[0]); }}>
              <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder={"Paste your essay, research paper, thesis, or dissertation here…\n\nSupports up to 200,000 words.\nOr drag & drop a .txt, .pdf, or .docx file."}
                style={{
                  width: "100%", height: "100%", resize: "none",
                  border: "none", outline: "none", padding: "20px 24px",
                  fontSize: 15, lineHeight: 1.8, color: "#111827",
                  background: dragOver ? "#f0fdf4" : "#fff",
                  transition: "background 0.2s",
                }}
              />
              {dragOver && (
                <div style={{
                  position: "absolute", inset: 0, background: "rgba(15,110,86,0.08)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  pointerEvents: "none", border: "2px dashed #0F6E56", borderRadius: 4,
                }}>
                  <span style={{ fontSize: 16, fontWeight: 600, color: "#0F6E56" }}>Drop file to upload</span>
                </div>
              )}
            </div>

            {/* Word / char count bar */}
            <div style={{ padding: "8px 24px", borderTop: "1px solid #e5e7eb", display: "flex", alignItems: "center", gap: 14, flexShrink: 0, background: "#fafafa" }}>
              <span style={{ fontSize: 12, color: wc > 200000 ? "#E24B4A" : "#6b7280" }}>{fmt(wc)} words</span>
              <span style={{ fontSize: 12, color: "#d1d5db" }}>•</span>
              <span style={{ fontSize: 12, color: "#6b7280" }}>{fmt(text.length)} chars</span>
              {wc > 0 && wc < 50    && <span style={{ fontSize: 12, color: "#D85A30" }}>⚠ min 50 words</span>}
              {wc > 200000          && <span style={{ fontSize: 12, color: "#E24B4A" }}>⚠ exceeds 200k limit</span>}
              <div style={{ flex: 1 }} />
              {wc > 0 && <span style={{ fontSize: 12, color: "#9ca3af" }}>~{Math.max(5, Math.round(wc / 500))}s estimate</span>}
            </div>

            {/* Error banner */}
            {error && (
              <div style={{ margin: "0 16px 8px", padding: "8px 12px", background: "#FCEBEB", color: "#A32D2D", borderRadius: 8, fontSize: 13 }}>
                ⚠ {error}
              </div>
            )}

            {/* Sensitivity slider */}
            <div style={{ padding: "8px 20px", borderTop: "1px solid #e5e7eb", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
              <span style={{ fontSize: 12, color: "#6b7280", whiteSpace: "nowrap" }}>Sensitivity</span>
              <input type="range" min="5" max="80" step="5" value={sensitivity}
                onChange={e => setSensitivity(+e.target.value)} style={{ flex: 1 }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: "#0F6E56", minWidth: 32 }}>{sensitivity}%</span>
            </div>

            {/* Check button */}
            <button
              onClick={runCheck}
              disabled={phase === "checking" || wc < 50 || wc > 200000}
              style={{
                ...S.btn("#0F6E56", "#fff", phase === "checking" || wc < 50 || wc > 200000),
                margin: "0 16px 16px", padding: "13px",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                fontSize: 15,
              }}>
              {phase === "checking" ? <><Spinner />{progressMsg}</> : "✦ Check for plagiarism"}
            </button>
          </div>
        )}

        {/* LEFT — Settings */}
        {tab === "settings" && (
          <div style={S.panel}>
            <div style={S.panelHead}>
              <span style={S.panelLabel}>Settings</span>
            </div>
            <div style={S.scroll}>

              {/* Sensitivity */}
              <div style={S.sHead}>Detection sensitivity</div>
              <div style={S.card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>Threshold</div>
                    <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>Lower = stricter, flags more. Higher = more lenient.</div>
                  </div>
                  <span style={{ fontSize: 20, fontWeight: 700, color: "#0F6E56" }}>{sensitivity}%</span>
                </div>
                <input type="range" min="5" max="80" step="5" value={sensitivity}
                  onChange={e => setSensitivity(+e.target.value)} style={{ width: "100%" }} />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#9ca3af", marginTop: 4 }}>
                  <span>Strict (5%)</span><span>Lenient (80%)</span>
                </div>
              </div>

              {/* Model info */}
              <div style={S.sHead}>AI model</div>
              <div style={S.card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>gemma2:2b</div>
                    <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>Running locally via Ollama</div>
                  </div>
                  <div style={{
                    width: 8, height: 8, borderRadius: "50%",
                    background: apiStatus.includes("connected") ? "#1D9E75" : "#e5e7eb"
                  }} />
                </div>
              </div>

              {/* Privacy */}
              <div style={S.sHead}>Privacy</div>
              <div style={{ ...S.card, background: "#f0fdf4", borderColor: "#bbf7d0" }}>
                <div style={{ fontSize: 13, color: "#166534", lineHeight: 1.9 }}>
                  ✓ No data stored anywhere<br />
                  ✓ No database or file storage<br />
                  ✓ Text analyzed in memory, discarded after<br />
                  ✓ Runs 100% on your local machine
                </div>
              </div>

              {/* About */}
              <div style={S.sHead}>About</div>
              <div style={S.card}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>PlagCheck</div>
                <div style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.7 }}>
                  Free, local plagiarism checker for students.<br />
                  Supports up to 200,000 words.<br />
                  Powered by MinHash fingerprinting + local LLM.
                </div>
                <div style={{ marginTop: 10 }}>
                  <a href="https://github.com/YOURUSERNAME/plagcheck" target="_blank" rel="noreferrer"
                    style={{ fontSize: 12, color: "#0F6E56", fontWeight: 600, textDecoration: "none" }}>
                    ★ View on GitHub →
                  </a>
                </div>
              </div>

            </div>
          </div>
        )}

        {/* RIGHT — Results panel */}
        <div style={S.results}>
          <div style={S.panelHead}>
            <span style={S.panelLabel}>Analysis results</span>
            {result && <button style={S.ghost} onClick={exportReport}>Export .txt</button>}
          </div>

          {/* Progress bar while checking */}
          {phase === "checking" && (
            <div style={{ padding: "14px 20px 0", flexShrink: 0 }}>
              <ProgressBar pct={progress} label={progressMsg} />
            </div>
          )}

          {/* Idle state */}
          {phase === "idle" && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "2rem", textAlign: "center", color: "#9ca3af" }}>
              <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.25 }}>◎</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: "#6b7280", marginBottom: 6 }}>Ready to check</div>
              <div style={{ fontSize: 13, lineHeight: 1.7, maxWidth: 260 }}>
                Paste your text or drop a file.<br />
                Supports up to 200,000 words.<br />
                Nothing is stored — local only.
              </div>
            </div>
          )}

          {/* Error state */}
          {phase === "error" && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "2rem", textAlign: "center" }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>⚠</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#374151", marginBottom: 6 }}>Analysis failed</div>
              <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 16 }}>{error}</div>
              <button style={S.btn()} onClick={runCheck}>Try again</button>
            </div>
          )}

          {/* Skeleton while checking */}
          {phase === "checking" && !result && (
            <div style={S.scroll}>
              {[100, 70, 85, 55].map((w, i) => (
                <div key={i} style={{ height: 14, background: "#f3f4f6", borderRadius: 8, marginBottom: 14, width: `${w}%`, animation: `fadeIn ${0.4 + i * 0.1}s ease` }} />
              ))}
            </div>
          )}

          {/* Results */}
          {result && (
            <div style={{ flex: 1, overflowY: "auto" }} className="fade-in">

              {/* Score + summary */}
              <div style={{ padding: "16px 20px", borderBottom: "1px solid #e5e7eb" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 14 }}>
                  <ScoreRing score={result.originality_score} color={vc.ring} size={90} />
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: vc.text, marginBottom: 4 }}>{result.verdict}</div>
                    <div style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.6, maxWidth: 230 }}>{result.summary}</div>
                  </div>
                </div>

                {/* Metric chips */}
                <div style={{ display: "flex", gap: 8 }}>
                  {[
                    { val: `${result.plagiarism_percentage}%`, lbl: "Similarity", col: vc.text },
                    { val: result.sources_found,               lbl: "Sources",    col: "#374151" },
                    { val: result.flagged_phrases,             lbl: "Flagged",    col: "#374151" },
                    { val: fmt(result.word_count),             lbl: "Words",      col: "#374151" },
                  ].map(m => (
                    <div key={m.lbl} style={S.metric}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: m.col }}>{m.val}</div>
                      <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>{m.lbl}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Sources */}
              <div style={{ padding: "0 20px" }}>
                {result.sources?.length > 0 && (
                  <>
                    <div style={S.sHead}>Matched sources</div>
                    {result.sources.map((src, i) => (
                      <div key={i} style={S.card}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                          <Badge type={src.type} />
                          <span style={{ fontSize: 16, fontWeight: 700, color: "#0F6E56" }}>{src.similarity}%</span>
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#111827", marginBottom: 2 }}>{src.title}</div>
                        <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{src.url}</div>
                        <ProgressBar pct={Math.min(src.similarity * 2.5, 100)}
                          color={src.type === "web" ? "#1D9E75" : src.type === "academic" ? "#185FA5" : "#534AB7"} />
                      </div>
                    ))}
                  </>
                )}

                {/* Flagged passages */}
                {result.highlighted_passages?.length > 0 && (
                  <>
                    <div style={S.sHead}>Flagged passages</div>
                    {result.highlighted_passages.map((p, i) => {
                      const c = { high: "#A32D2D", medium: "#854F0B", low: "#185FA5" }[p.severity] || "#185FA5";
                      return (
                        <div key={i} style={{ borderLeft: `3px solid ${c}`, background: "#fafafa", borderRadius: "0 8px 8px 0", padding: "8px 12px", marginBottom: 10 }}>
                          <div style={{ fontSize: 13, color: "#374151", fontStyle: "italic", lineHeight: 1.6 }}>"{p.text}"</div>
                          <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>→ {p.source}</div>
                        </div>
                      );
                    })}
                  </>
                )}

                {/* Recommendations */}
                {result.suggestions?.length > 0 && (
                  <>
                    <div style={S.sHead}>Recommendations</div>
                    {result.suggestions.map((s, i) => (
                      <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "8px 0", borderBottom: "1px solid #f3f4f6" }}>
                        <div style={{
                          width: 20, height: 20, borderRadius: "50%", flexShrink: 0, marginTop: 1,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 11, fontWeight: 700,
                          background: s.type === "warning" ? "#FAEEDA" : "#EAF3DE",
                          color:      s.type === "warning" ? "#854F0B" : "#3B6D11",
                        }}>
                          {s.type === "warning" ? "!" : "✓"}
                        </div>
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