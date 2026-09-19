import { useCallback, useMemo, useState } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";

// ─── Theme constants — mirrors Overview.tsx dark-neon palette ───

const T = {
  bg: "#0a0a0f",
  card: "rgba(30,15,50,0.8)",
  border: "1px solid rgba(139,92,246,0.2)",
  text: "#e0e0e0",
  muted: "#8b8ba0",
  heading: "#8B5CF6",
  fn: "#F59E0B",
  cyan: "#00e5ff",
  gold: "#fbbf24",
  mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
};

interface LiveTestRow {
  _id: string;
  langCode: string;
  langName: string;
  nativeName: string;
  script: string;
  rtl: boolean;
  status: string;
  score?: number;
  output?: string;
  qaSummary?: string[];
  issueCount?: number;
  missingNames?: string[];
  scriptIssues?: string[];
  model?: string;
  durationMs?: number;
  error?: string;
  testedAt: number;
}

const STATUS_STYLE: Record<string, { color: string; bg: string }> = {
  pass: { color: "#22c55e", bg: "rgba(34,197,94,0.12)" },
  warn: { color: "#fbbf24", bg: "rgba(251,191,36,0.12)" },
  fail: { color: "#ef4444", bg: "rgba(239,68,68,0.12)" },
  running: { color: "#00e5ff", bg: "rgba(0,229,255,0.12)" },
  pending: { color: "#8b8ba0", bg: "rgba(139,147,165,0.12)" },
};

const LANG_ORDER = [
  "ur", "ar", "fr", "ja", "es", "hi", "tr", "zh", "ru", "ko",
  "de", "ks", "ro", "sw", "it", "la", "id", "ne", "bn", "pt",
];

function scoreColor(score: number | undefined): string {
  if (score === undefined) return T.muted;
  if (score >= 90) return "#22c55e";
  if (score >= 75) return "#fbbf24";
  if (score >= 60) return "#f97316";
  return "#ef4444";
}

/** Render mixed LTR/RTL/CJK output safely inside an LTR dashboard. */
function OutputBlock({ text, rtl }: { text: string; rtl: boolean }) {
  return (
    <pre
      dir={rtl ? "rtl" : "ltr"}
      style={{
        background: "rgba(0,0,0,0.35)",
        border: "1px solid rgba(0,229,255,0.15)",
        borderRadius: 8,
        padding: "10px 12px",
        fontSize: 13,
        lineHeight: 1.9,
        fontFamily: T.mono,
        color: T.text,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        margin: 0,
        textAlign: rtl ? "right" : "left",
      }}
    >
      {text}
    </pre>
  );
}

function LanguageRow({ row }: { row: LiveTestRow }) {
  const [open, setOpen] = useState(false);
  const st = STATUS_STYLE[row.status] ?? STATUS_STYLE.pending;
  const hasDetail = !!(row.output || (row.qaSummary && row.qaSummary.length > 0) || row.error);

  return (
    <div style={{ border: "1px solid rgba(139,92,246,0.12)", borderRadius: 10, overflow: "hidden" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          padding: "10px 14px",
          background: "rgba(0,0,0,0.25)",
          border: "none",
          cursor: hasDetail ? "pointer" : "default",
          textAlign: "left",
        }}
      >
        <span
          style={{
            color: st.color,
            background: st.bg,
            border: `1px solid ${st.color}55`,
            borderRadius: 4,
            padding: "2px 8px",
            fontSize: 9,
            fontFamily: T.mono,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            minWidth: 58,
            textAlign: "center",
          }}
        >
          {row.status}
        </span>
        <span style={{ color: T.gold, fontSize: 13, fontFamily: T.mono, fontWeight: 700, minWidth: 92 }}>
          {row.langName}
        </span>
        <span style={{ color: T.muted, fontSize: 11.5, fontFamily: T.mono }}>
          {row.nativeName} · {row.script}
          {row.rtl ? " · RTL" : ""}
        </span>
        <span style={{ flex: 1 }} />
        {row.score !== undefined && (
          <span style={{ color: scoreColor(row.score), fontSize: 13, fontFamily: T.mono, fontWeight: 700 }}>
            {row.score}/100
          </span>
        )}
        {row.durationMs !== undefined && (
          <span style={{ color: T.muted, fontSize: 10, fontFamily: T.mono }}>
            {(row.durationMs / 1000).toFixed(1)}s
          </span>
        )}
        {row.model && (
          <span
            style={{
              color: T.muted,
              fontSize: 9.5,
              fontFamily: T.mono,
              maxWidth: 130,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {row.model}
          </span>
        )}
        {hasDetail && (
          <span style={{ color: T.heading, fontSize: 10, fontFamily: T.mono }}>{open ? "▲" : "▼"}</span>
        )}
      </button>

      {open && (
        <div style={{ padding: "4px 14px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
          {row.error && (
            <div
              style={{
                color: "#ef4444",
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.3)",
                borderRadius: 8,
                padding: "8px 12px",
                fontSize: 11.5,
                fontFamily: T.mono,
                whiteSpace: "pre-wrap",
              }}
            >
              {row.error}
            </div>
          )}

          {row.qaSummary && row.qaSummary.length > 0 && (
            <div>
              <div
                style={{
                  color: T.cyan,
                  fontSize: 10,
                  fontFamily: T.mono,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: 6,
                }}
              >
                QA summary
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {row.qaSummary.map((s, i) => (
                  <div
                    key={i}
                    style={{
                      color: s.includes("✗") ? "#ef4444" : s.includes("⚠") ? "#fbbf24" : T.text,
                      fontSize: 11,
                      fontFamily: T.mono,
                    }}
                  >
                    {s}
                  </div>
                ))}
              </div>
            </div>
          )}

          {row.output && (
            <div>
              <div
                style={{
                  color: T.cyan,
                  fontSize: 10,
                  fontFamily: T.mono,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: 6,
                }}
              >
                Translated output (production post-processing)
              </div>
              <OutputBlock text={row.output} rtl={row.rtl} />
            </div>
          )}

          {row.missingNames && row.missingNames.length > 0 && (
            <div style={{ color: "#ef4444", fontSize: 11, fontFamily: T.mono }}>
              Missing locked names: {row.missingNames.join(", ")}
            </div>
          )}

          <div style={{ color: T.muted, fontSize: 10, fontFamily: T.mono }}>
            tested {new Date(row.testedAt).toLocaleString()} · langCode: {row.langCode}
          </div>
        </div>
      )}
    </div>
  );
}

export default function LiveTestPanel() {
  const rows = useQuery(api.liveTestStore.getLiveTests) ?? [];
  const runAll = useAction(api.liveTest.runAllLiveTests);
  const clear = useMutation(api.liveTestStore.clearLiveTests);
  const [scheduling, setScheduling] = useState(false);

  const byLang = useMemo(() => new Map(rows.map((r) => [r.langCode, r])), [rows]);
  const orderedRows = useMemo(() => {
    const out: LiveTestRow[] = [];
    for (const code of LANG_ORDER) {
      const r = byLang.get(code);
      if (r) out.push(r as unknown as LiveTestRow);
    }
    return out;
  }, [byLang]);

  const done = rows.filter((r) => r.status === "pass" || r.status === "warn" || r.status === "fail").length;
  const runningCount = rows.filter((r) => r.status === "running").length;
  const passed = rows.filter((r) => r.status === "pass").length;
  const warned = rows.filter((r) => r.status === "warn").length;
  const failed = rows.filter((r) => r.status === "fail").length;
  const scores = rows.filter((r) => typeof r.score === "number").map((r) => r.score!);
  const avg = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;

  const handleRunAll = useCallback(() => {
    setScheduling(true);
    runAll({}).finally(() => {
      // The suite is chained server-side; rows update reactively.
      setScheduling(false);
    });
  }, [runAll]);

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Summary card */}
      <div
        style={{
          background: T.card,
          border: T.border,
          borderRadius: 12,
          padding: 16,
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 16,
        }}
      >
        <div>
          <h3
            style={{
              color: T.heading,
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              margin: 0,
            }}
          >
            Live Gemini Test Results — All 20 Languages
          </h3>
          <p style={{ color: T.muted, fontSize: 11.5, margin: "6px 0 0", lineHeight: 1.6 }}>
            Every row is a REAL Gemini round-trip using the exact production pipeline: 23-phase system
            prompt · Bible Pass glossary lock · post-processing · QA engine. Locked source sentence:{" "}
            <span style={{ color: T.text, fontFamily: T.mono, fontSize: 10.5 }}>
              “Violet wakes up in Aretia confused, with a ring and a note from Xaden: ‘Don't look for
              me.’ She realizes she is married, but her husband is lost in the dark.”
            </span>
          </p>
        </div>
        <div style={{ flex: 1 }} />
        <button
          onClick={handleRunAll}
          disabled={scheduling}
          style={{
            background: scheduling ? "rgba(139,92,246,0.08)" : "rgba(139,92,246,0.18)",
            border: T.border,
            color: scheduling ? T.muted : T.heading,
            borderRadius: 8,
            padding: "9px 16px",
            fontSize: 12,
            fontFamily: T.mono,
            cursor: scheduling ? "default" : "pointer",
            whiteSpace: "nowrap",
          }}
        >
          {scheduling ? "Scheduled…" : "▶ Run all 20 tests"}
        </button>
        <button
          onClick={() => clear({})}
          style={{
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.25)",
            color: "#ef4444",
            borderRadius: 8,
            padding: "9px 14px",
            fontSize: 11,
            fontFamily: T.mono,
            cursor: "pointer",
          }}
        >
          Clear
        </button>
      </div>

      {/* Aggregate stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 10 }}>
        {[
          { label: "Tested", value: `${done}/20`, color: T.cyan },
          { label: "Pass", value: passed, color: "#22c55e" },
          { label: "Warn", value: warned, color: "#fbbf24" },
          { label: "Fail", value: failed, color: "#ef4444" },
          { label: "Running", value: runningCount, color: "#00e5ff" },
          { label: "Avg Score", value: avg === null ? "—" : `${avg}/100`, color: avg === null ? T.muted : scoreColor(avg) },
        ].map((s) => (
          <div
            key={s.label}
            style={{
              background: "rgba(0,0,0,0.3)",
              border: "1px solid rgba(0,229,255,0.15)",
              borderRadius: 8,
              padding: "10px 12px",
            }}
          >
            <div style={{ color: s.color, fontSize: 18, fontWeight: 700, fontFamily: T.mono }}>{s.value}</div>
            <div style={{ color: T.muted, fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* Progress bar */}
      <div style={{ background: "rgba(0,0,0,0.35)", borderRadius: 6, height: 6, overflow: "hidden" }}>
        <div
          style={{
            width: `${(done / 20) * 100}%`,
            height: "100%",
            background: "linear-gradient(90deg, #8B5CF6, #00e5ff)",
            transition: "width 0.4s ease",
          }}
        />
      </div>

      {/* Per-language rows */}
      {orderedRows.length === 0 ? (
        <div style={{ color: T.muted, fontSize: 12, fontFamily: T.mono, padding: "16px 0" }}>
          No results yet — click “Run all 20 tests” to launch the suite. Results stream in as each
          language completes (server-side chaining, survives page close).
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {orderedRows.map((row) => (
            <LanguageRow key={row._id} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}
