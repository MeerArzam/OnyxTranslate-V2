import { useState, useCallback, useEffect, useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";
import rawDoc from "../docs/PROJECT_DOCUMENTATION.json";
import LiveTestPanel from "@/components/LiveTestPanel";

// ─── Types (loosely cast — the JSON is generated) ───

interface CalledBy {
  file: string;
  line: number;
}
interface ExportedItem {
  name: string;
  kind: string;
  lineRange?: string;
  calledBy?: CalledBy[];
}
interface CssClassInfo {
  name: string;
  keyProperties?: string[];
  usedBy?: string[];
}
interface FileDoc {
  path: string;
  purpose: string;
  lineCount: number;
  imports?: string[];
  exportedItems?: ExportedItem[];
  cssClasses?: CssClassInfo[];
}
interface StateVar {
  name: string;
  type?: string;
  defaultValue?: string;
  line?: number;
  setter?: string;
  purpose?: string;
}
interface HookInfo {
  hook: string;
  variable?: string;
  target?: string;
  line?: number;
  purpose?: string;
}
interface KeyFn {
  name: string;
  line: number;
  keyCode?: string[];
}
interface ComponentDoc {
  path: string;
  purpose: string;
  lineCount: number;
  imports?: string[];
  state?: StateVar[];
  convexHooks?: HookInfo[];
  keyFunctions?: KeyFn[];
  props?: { name: string; type: string; description: string }[];
  hooks?: HookInfo[];
  keySequences?: { phase: string; css: string; timing: string }[];
}
interface KeyExport {
  file: string;
  name: string;
  kind: string;
  lineRange?: string;
  calledBy?: CalledBy[];
  keyCode?: string[];
}
interface TableDoc {
  name: string;
  fields: { name: string; type: string }[];
  indexes?: string[];
}
interface DocDoc {
  project: {
    name: string;
    generatedAt: string;
    totalFiles: number;
    totalLines: number;
    stack: string;
  };
  files: FileDoc[];
  components: ComponentDoc[];
  keyExports: KeyExport[];
  dataFlow: Record<string, string>;
  schema: { tables: TableDoc[] };
  cssClasses: CssClassInfo[];
  dependencies: { runtime: string[]; dev: string[]; envVars: string[] };
  routing?: { scheme: string; entry: string; lazy: string };
}

const doc = rawDoc as unknown as DocDoc;

// ─── Theme constants (dark neon — same palette as index.css) ───

const T = {
  bg: "#0a0a0f",
  card: "rgba(30,15,50,0.8)",
  cardSolid: "#120a20",
  border: "1px solid rgba(139,92,246,0.2)",
  borderBright: "1px solid rgba(139,92,246,0.5)",
  text: "#e0e0e0",
  muted: "#8b8ba0",
  heading: "#8B5CF6",
  fn: "#F59E0B",
  cyan: "#00e5ff",
  gold: "#fbbf24",
  mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
};

const BADGE_COLORS: Record<string, { color: string; bg: string }> = {
  action: { color: "#22c55e", bg: "rgba(34,197,94,0.12)" },
  internalAction: { color: "#22c55e", bg: "rgba(34,197,94,0.12)" },
  query: { color: "#22c55e", bg: "rgba(34,197,94,0.12)" },
  internalQuery: { color: "#22c55e", bg: "rgba(34,197,94,0.12)" },
  mutation: { color: "#3b82f6", bg: "rgba(59,130,246,0.12)" },
  internalMutation: { color: "#3b82f6", bg: "rgba(59,130,246,0.12)" },
  component: { color: "#a78bfa", bg: "rgba(139,92,246,0.12)" },
  function: { color: "#F59E0B", bg: "rgba(245,158,11,0.12)" },
  "async function": { color: "#F59E0B", bg: "rgba(245,158,11,0.12)" },
  interface: { color: "#22d3ee", bg: "rgba(34,211,238,0.10)" },
  type: { color: "#22d3ee", bg: "rgba(34,211,238,0.10)" },
  enum: { color: "#22d3ee", bg: "rgba(34,211,238,0.10)" },
  class: { color: "#22d3ee", bg: "rgba(34,211,238,0.10)" },
  "default export": { color: "#94a3b8", bg: "rgba(148,163,184,0.12)" },
};

function badgeStyle(kind: string): { color: string; bg: string } {
  return BADGE_COLORS[kind] ?? { color: "#94a3b8", bg: "rgba(148,163,184,0.12)" };
}

function Badge({ kind }: { kind: string }) {
  const s = badgeStyle(kind);
  return (
    <span
      style={{
        color: s.color,
        background: s.bg,
        border: `1px solid ${s.color}44`,
        borderRadius: 4,
        padding: "1px 6px",
        fontSize: 9,
        fontFamily: T.mono,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        whiteSpace: "nowrap",
      }}
    >
      {kind}
    </span>
  );
}

function CodeBlock({ code }: { code: string[] }) {
  return (
    <pre
      style={{
        background: "rgba(0,0,0,0.3)",
        padding: "12px",
        borderRadius: "8px",
        overflow: "auto",
        fontSize: "11px",
        fontFamily: T.mono,
        color: "#e0e0e0",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        margin: 0,
        lineHeight: 1.55,
        border: "1px solid rgba(139,92,246,0.12)",
      }}
    >
      {code.join("\n")}
    </pre>
  );
}

function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        background: T.card,
        border: T.border,
        borderRadius: 12,
        padding: 16,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3
      style={{
        color: T.heading,
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        margin: "0 0 8px 0",
      }}
    >
      {children}
    </h3>
  );
}

// ─── File tree helpers ───

const GROUP_ORDER = [
  "convex/",
  "src/pages/",
  "src/components/",
  "src/components/ui/",
  "src/lib/translator/",
  "src/lib/",
  "src/data/localization/",
  "src/data/",
  "src/hooks/",
  "src/types/",
  "src/",
  "root",
  "public/",
  "scripts/",
  "isolate/",
];

function groupOf(path: string): string {
  if (!path.includes("/")) return "root";
  if (path.startsWith("src/lib/translator/")) return "src/lib/translator/";
  if (path.startsWith("src/components/ui/")) return "src/components/ui/";
  if (path.startsWith("src/data/localization/")) return "src/data/localization/";
  return path.slice(0, path.indexOf("/") + 1);
}

// Resolve an import specifier to a project path (for imported-by computation)
function resolveImport(importer: string, spec: string, pathSet: Set<string>): string | null {
  let base: string;
  if (spec.startsWith("@/")) {
    base = "src/" + spec.slice(2);
  } else if (spec.startsWith(".")) {
    const dirParts = importer.includes("/") ? importer.slice(0, importer.lastIndexOf("/")).split("/") : [];
    for (const seg of spec.split("/")) {
      if (seg === ".") continue;
      else if (seg === "..") dirParts.pop();
      else dirParts.push(seg);
    }
    base = dirParts.join("/");
  } else {
    return null; // external package
  }
  const candidates = [
    base,
    base + ".ts",
    base + ".tsx",
    base + ".css",
    base + ".json",
    base + "/index.ts",
    base + "/index.tsx",
  ];
  for (const c of candidates) if (pathSet.has(c)) return c;
  return null;
}

// ─── Main component ───

export default function Overview() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [isNarrow, setIsNarrow] = useState(() => window.innerWidth < 860);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // View switch: codebase docs ↔ live per-language Gemini test results
  const [view, setView] = useState<"docs" | "livetest">("docs");

  // Debounce search 300ms
  useEffect(() => {
    const t = window.setTimeout(() => setSearch(searchInput.trim().toLowerCase()), 300);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  // Responsive sidebar
  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth < 860);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // importedBy map
  const importedBy = useMemo(() => {
    const pathSet = new Set(doc.files.map((f) => f.path));
    const map = new Map<string, string[]>();
    for (const f of doc.files) {
      for (const spec of f.imports ?? []) {
        const resolved = resolveImport(f.path, spec, pathSet);
        if (resolved && resolved !== f.path) {
          const arr = map.get(resolved) ?? [];
          if (!arr.includes(f.path)) arr.push(f.path);
          map.set(resolved, arr);
        }
      }
    }
    return map;
  }, []);

  // Filtered file list
  const filteredFiles = useMemo(() => {
    const files = doc.files;
    if (!search) return files;
    return files.filter((f) => {
      if (f.path.toLowerCase().includes(search)) return true;
      if ((f.purpose ?? "").toLowerCase().includes(search)) return true;
      for (const e of f.exportedItems ?? []) {
        if (e.name.toLowerCase().includes(search)) return true;
      }
      return false;
    });
  }, [search]);

  // Grouped tree
  const groups = useMemo(() => {
    const map = new Map<string, FileDoc[]>();
    for (const f of filteredFiles) {
      const g = groupOf(f.path);
      const arr = map.get(g) ?? [];
      arr.push(f);
      map.set(g, arr);
    }
    const ordered: { group: string; files: FileDoc[] }[] = [];
    const seen = new Set<string>();
    for (const g of GROUP_ORDER) {
      if (map.has(g)) {
        ordered.push({ group: g, files: map.get(g)!.sort((a, b) => a.path.localeCompare(b.path)) });
        seen.add(g);
      }
    }
    for (const [g, files] of map) {
      if (!seen.has(g)) ordered.push({ group: g, files: files.sort((a, b) => a.path.localeCompare(b.path)) });
    }
    return ordered;
  }, [filteredFiles]);

  const selectedFile = useMemo(
    () => (selected ? doc.files.find((f) => f.path === selected) ?? null : null),
    [selected]
  );
  const selectedComponent = useMemo(
    () => (selected ? doc.components.find((c) => c.path === selected) ?? null : null),
    [selected]
  );
  const selectedKeyExports = useMemo(
    () => (selected ? doc.keyExports.filter((k) => k.file === selected) : []),
    [selected]
  );
  const selectedImportedBy = useMemo(
    () => (selected ? importedBy.get(selected) ?? [] : []),
    [selected, importedBy]
  );

  const selectFile = useCallback((path: string) => {
    setSelected(path);
    setSidebarOpen(false);
  }, []);

  const sidebar = (
    <div
      style={{
        width: 250,
        flexShrink: 0,
        borderRight: "1px solid rgba(139,92,246,0.15)",
        overflowY: "auto",
        background: "rgba(0,0,0,0.25)",
        height: "100%",
      }}
    >
      {groups.length === 0 && (
        <div style={{ padding: 16, color: T.muted, fontSize: 12 }}>No files match "{searchInput}"</div>
      )}
      {groups.map(({ group, files }) => (
        <div key={group}>
          <div
            style={{
              padding: "10px 14px 4px",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.1em",
              color: T.heading,
              fontFamily: T.mono,
              textTransform: "uppercase",
            }}
          >
            {group === "root" ? "/ (root)" : group}
          </div>
          {files.map((f) => {
            const isSel = f.path === selected;
            const name = f.path.slice(f.path.lastIndexOf("/") + 1);
            return (
              <button
                key={f.path}
                onClick={() => selectFile(f.path)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  width: "100%",
                  padding: "6px 14px",
                  background: isSel ? "rgba(139,92,246,0.15)" : "transparent",
                  border: "none",
                  borderLeft: isSel ? "2px solid #8B5CF6" : "2px solid transparent",
                  color: isSel ? T.gold : T.text,
                  fontSize: 11.5,
                  fontFamily: T.mono,
                  textAlign: "left",
                  cursor: "pointer",
                }}
                title={f.purpose}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {name}
                </span>
                <span style={{ color: T.muted, fontSize: 9.5, flexShrink: 0 }}>{f.lineCount}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );

  return (
    <div style={{ background: T.bg, minHeight: "100vh", color: T.text }}>
      {/* ─── Top bar ─── */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          background: "rgba(6,6,14,0.92)",
          borderBottom: "1px solid rgba(0,229,255,0.10)",
          padding: "0 16px",
          height: 52,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <a
          href="#/"
          style={{
            color: T.cyan,
            textDecoration: "none",
            fontSize: 12,
            fontFamily: T.mono,
            border: "1px solid rgba(0,229,255,0.25)",
            borderRadius: 6,
            padding: "5px 10px",
            whiteSpace: "nowrap",
          }}
        >
          &larr; Back to Translator
        </a>
        {isNarrow && (
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            style={{
              background: "rgba(139,92,246,0.12)",
              border: T.border,
              color: T.heading,
              borderRadius: 6,
              padding: "5px 10px",
              fontSize: 12,
              cursor: "pointer",
              fontFamily: T.mono,
            }}
          >
            {sidebarOpen ? "✕ Files" : "☰ Files"}
          </button>
        )}
        <span
          className="logo-gradient"
          style={{ fontSize: 14, fontWeight: 700, letterSpacing: "0.04em", whiteSpace: "nowrap" }}
        >
          {view === "docs" ? "Codebase Documentation" : "Live Language Tests"}
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setView((v) => (v === "docs" ? "livetest" : "docs"))}
          style={{
            background: view === "livetest" ? "rgba(0,229,255,0.15)" : "rgba(139,92,246,0.12)",
            border: view === "livetest" ? "1px solid rgba(0,229,255,0.45)" : T.border,
            color: view === "livetest" ? T.cyan : T.heading,
            borderRadius: 6,
            padding: "5px 12px",
            fontSize: 11.5,
            fontFamily: T.mono,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
          title="Run / view REAL Gemini round-trip tests for all 20 languages"
        >
          {view === "docs" ? "⚡ Live Tests" : "📄 Docs"}
        </button>
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search files, functions, params…"
          style={{
            width: isNarrow ? 150 : 280,
            background: "rgba(0,0,0,0.4)",
            border: "1px solid rgba(139,92,246,0.25)",
            borderRadius: 8,
            padding: "7px 12px",
            color: T.text,
            fontSize: 12,
            outline: "none",
            fontFamily: T.mono,
          }}
        />
      </div>

      {/* ─── Body ─── */}
      <div style={{ display: "flex", height: "calc(100vh - 52px)", overflow: "hidden", position: "relative" }}>
        {/* Sidebar: fixed overlay on narrow screens */}
        {(!isNarrow || sidebarOpen) &&
          (isNarrow ? (
            <div style={{ position: "absolute", inset: 0, zIndex: 40, display: "flex" }}>
              <div
                style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)" }}
                onClick={() => setSidebarOpen(false)}
              />
              <div style={{ position: "relative", zIndex: 41, background: T.bg, height: "100%" }}>{sidebar}</div>
            </div>
          ) : (
            sidebar
          ))}

        {/* Main panel */}
        <div style={{ flex: 1, overflowY: "auto", padding: 20, minWidth: 0 }}>
          {view === "livetest" ? (
            <LiveTestPanel />
          ) : !selectedFile ? (
            <ProjectOverview onOpenFile={selectFile} />
          ) : (
            <FileDetail
              file={selectedFile}
              component={selectedComponent}
              keyExports={selectedKeyExports}
              importedBy={selectedImportedBy}
              cssUsage={doc.cssClasses.find((c) => c.name === "." + selectedFile.path.slice(selectedFile.path.lastIndexOf("/") + 1, selectedFile.path.lastIndexOf(".")))}
              allCss={doc.cssClasses}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Project overview (default view) ───

function ProjectOverview({ onOpenFile }: { onOpenFile: (p: string) => void }) {
  const [showAllExports, setShowAllExports] = useState(false);
  const exportsShown = showAllExports ? doc.keyExports : doc.keyExports.slice(0, 8);

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header */}
      <Card>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }} className="logo-gradient">
            {doc.project.name}
          </h1>
          <span style={{ color: T.muted, fontSize: 11, fontFamily: T.mono }}>
            generated {doc.project.generatedAt}
          </span>
        </div>
        <p style={{ color: T.muted, fontSize: 12.5, margin: "8px 0 0" }}>{doc.project.stack}</p>
        <div style={{ display: "flex", gap: 14, marginTop: 12, flexWrap: "wrap" }}>
          <Stat label="Files" value={doc.project.totalFiles} />
          <Stat label="Lines" value={doc.project.totalLines.toLocaleString()} />
          <Stat label="DB Tables" value={doc.schema.tables.length} />
          <Stat label="Documented Exports" value={doc.keyExports.length} />
        </div>
        {doc.routing && (
          <p style={{ color: T.muted, fontSize: 11, margin: "12px 0 0", fontFamily: T.mono }}>
            {doc.routing.scheme}
          </p>
        )}
      </Card>

      {/* Data flow */}
      <Card>
        <SectionTitle>Data Flow</SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
          {Object.entries(doc.dataFlow).map(([k, v]) => (
            <div
              key={k}
              style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(139,92,246,0.12)", borderRadius: 8, padding: 12 }}
            >
              <div style={{ color: T.cyan, fontSize: 11, fontFamily: T.mono, fontWeight: 700, marginBottom: 6 }}>
                {k}
              </div>
              <div style={{ color: T.text, fontSize: 11.5, lineHeight: 1.6 }}>{v}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* Schema */}
      <Card>
        <SectionTitle>Convex Schema</SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
          {doc.schema.tables.map((t) => (
            <div
              key={t.name}
              style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(139,92,246,0.12)", borderRadius: 8, padding: 12 }}
            >
              <div style={{ color: T.gold, fontSize: 12, fontFamily: T.mono, fontWeight: 700, marginBottom: 6 }}>
                {t.name}
              </div>
              {t.fields.map((f) => (
                <div key={f.name} style={{ display: "flex", gap: 8, fontSize: 10.5, fontFamily: T.mono, padding: "1px 0" }}>
                  <span style={{ color: T.text, minWidth: 90 }}>{f.name}</span>
                  <span style={{ color: T.muted }}>{f.type}</span>
                </div>
              ))}
              {t.indexes && t.indexes.length > 0 && (
                <div style={{ color: T.heading, fontSize: 9.5, fontFamily: T.mono, marginTop: 6 }}>
                  idx: {t.indexes.join(", ")}
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* Key exports */}
      <Card>
        <SectionTitle>Key Exports {showAllExports ? "" : `(${doc.keyExports.length} total)`}</SectionTitle>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {exportsShown.map((k, i) => (
            <div
              key={k.file + k.name + i}
              style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(139,92,246,0.12)", borderRadius: 8, padding: 12 }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                <Badge kind={k.kind} />
                <button
                  onClick={() => onOpenFile(k.file)}
                  style={{
                    background: "none",
                    border: "none",
                    color: T.gold,
                    fontSize: 12.5,
                    fontFamily: T.mono,
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  {k.name}
                </button>
                <span style={{ color: T.muted, fontSize: 10, fontFamily: T.mono }}>
                  {k.file}{k.lineRange ? `:${k.lineRange}` : ""}
                </span>
              </div>
              {k.keyCode && <CodeBlock code={k.keyCode} />}
            </div>
          ))}
        </div>
        {!showAllExports && (
          <button
            onClick={() => setShowAllExports(true)}
            style={{
              marginTop: 12,
              background: "rgba(139,92,246,0.12)",
              border: T.border,
              color: T.heading,
              borderRadius: 6,
              padding: "6px 14px",
              fontSize: 11,
              cursor: "pointer",
              fontFamily: T.mono,
            }}
          >
            Show all {doc.keyExports.length} exports
          </button>
        )}
      </Card>

      {/* Dependencies */}
      <Card>
        <SectionTitle>Dependencies &amp; Environment</SectionTitle>
        <div style={{ fontSize: 11.5, lineHeight: 1.9 }}>
          <div>
            <span style={{ color: T.cyan, fontFamily: T.mono }}>runtime: </span>
            <span style={{ color: T.muted }}>{doc.dependencies.runtime.join(", ")}</span>
          </div>
          <div>
            <span style={{ color: T.cyan, fontFamily: T.mono }}>dev: </span>
            <span style={{ color: T.muted }}>{doc.dependencies.dev.join(", ")}</span>
          </div>
          <div>
            <span style={{ color: T.cyan, fontFamily: T.mono }}>env: </span>
            <span style={{ color: T.muted }}>{doc.dependencies.envVars.join(", ")}</span>
          </div>
        </div>
      </Card>

      {/* Theme classes */}
      <Card>
        <SectionTitle>Theme CSS Classes ({doc.cssClasses.length})</SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 8 }}>
          {doc.cssClasses.map((c) => (
            <div
              key={c.name}
              style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(139,92,246,0.12)", borderRadius: 8, padding: 10 }}
            >
              <span style={{ color: T.gold, fontSize: 11.5, fontFamily: T.mono }}>{c.name}</span>
              <div style={{ color: T.muted, fontSize: 10, marginTop: 4 }}>
                used by: {c.usedBy && c.usedBy.length > 0 ? c.usedBy.map((u) => u.slice(u.lastIndexOf("/") + 1)).join(", ") : "index.css only"}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div
      style={{
        background: "rgba(0,0,0,0.3)",
        border: "1px solid rgba(0,229,255,0.15)",
        borderRadius: 8,
        padding: "8px 14px",
      }}
    >
      <div style={{ color: T.cyan, fontSize: 16, fontWeight: 700, fontFamily: T.mono }}>{value}</div>
      <div style={{ color: T.muted, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div>
    </div>
  );
}

// ─── File detail view ───

function FileDetail({
  file,
  component,
  keyExports,
  importedBy,
  cssUsage,
}: {
  file: FileDoc;
  component: ComponentDoc | null;
  keyExports: KeyExport[];
  importedBy: string[];
  cssUsage?: CssClassInfo;
  allCss?: CssClassInfo[];
}) {
  const ext = file.path.slice(file.path.lastIndexOf(".") + 1);
  const kindGuess = ext === "css" ? "stylesheet" : ext === "json" ? "data" : file.path.endsWith(".tsx") ? "component/page" : "module";

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header */}
      <Card>
        <div style={{ fontFamily: T.mono, fontSize: 14, color: T.gold, wordBreak: "break-all" }}>{file.path}</div>
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Badge kind={kindGuess} />
          <span style={{ color: T.muted, fontSize: 11, fontFamily: T.mono }}>{file.lineCount} lines</span>
        </div>
        <p style={{ color: T.text, fontSize: 13, margin: "10px 0 0", lineHeight: 1.6 }}>{file.purpose}</p>
      </Card>

      {/* Imports / imported-by */}
      {(file.imports && file.imports.length > 0) || importedBy.length > 0 ? (
        <Card>
          <SectionTitle>Imports &amp; Reverse Dependencies</SectionTitle>
          {file.imports && file.imports.length > 0 && (
            <div style={{ marginBottom: importedBy.length ? 12 : 0 }}>
              <div style={{ color: T.cyan, fontSize: 10.5, fontFamily: T.mono, marginBottom: 4 }}>imports:</div>
              {file.imports.map((s) => (
                <div key={s} style={{ color: T.muted, fontSize: 11, fontFamily: T.mono, paddingLeft: 10 }}>
                  {s}
                </div>
              ))}
            </div>
          )}
          {importedBy.length > 0 && (
            <div>
              <div style={{ color: T.cyan, fontSize: 10.5, fontFamily: T.mono, marginBottom: 4 }}>imported by:</div>
              {importedBy.map((f) => (
                <div key={f} style={{ color: T.muted, fontSize: 11, fontFamily: T.mono, paddingLeft: 10 }}>
                  {f}
                </div>
              ))}
            </div>
          )}
        </Card>
      ) : null}

      {/* Exported items */}
      {file.exportedItems && file.exportedItems.length > 0 && (
        <Card>
          <SectionTitle>Exports ({file.exportedItems.length})</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {file.exportedItems.map((e) => (
              <div
                key={e.name}
                style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(139,92,246,0.12)", borderRadius: 8, padding: 12 }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <Badge kind={e.kind} />
                  <span style={{ color: T.fn, fontSize: 12.5, fontFamily: T.mono, fontWeight: 600 }}>{e.name}</span>
                  {e.lineRange && (
                    <span style={{ color: T.muted, fontSize: 10, fontFamily: T.mono }}>:{e.lineRange}</span>
                  )}
                </div>
                {e.calledBy && e.calledBy.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    <span style={{ color: T.heading, fontSize: 10, fontFamily: T.mono }}>referenced in: </span>
                    {e.calledBy.map((c, i) => (
                      <span key={c.file + i} style={{ color: T.muted, fontSize: 10, fontFamily: T.mono }}>
                        {c.file}
                        {i < e.calledBy!.length - 1 ? ", " : ""}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Key exports with real code */}
      {keyExports.length > 0 && (
        <Card>
          <SectionTitle>Source Code</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {keyExports.map((k, i) => (
              <div key={k.name + i}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                  <Badge kind={k.kind} />
                  <span style={{ color: T.fn, fontSize: 12.5, fontFamily: T.mono, fontWeight: 600 }}>{k.name}</span>
                  {k.lineRange && (
                    <span style={{ color: T.muted, fontSize: 10, fontFamily: T.mono }}>:{k.lineRange}</span>
                  )}
                </div>
                {k.keyCode && <CodeBlock code={k.keyCode} />}
                {k.calledBy && k.calledBy.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    <span style={{ color: T.heading, fontSize: 10, fontFamily: T.mono }}>called by: </span>
                    {k.calledBy.map((c, j) => (
                      <span key={c.file + j} style={{ color: T.muted, fontSize: 10, fontFamily: T.mono }}>
                        {c.file}:{c.line}
                        {j < k.calledBy!.length - 1 ? ", " : ""}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Component-specific: props */}
      {component?.props && component.props.length > 0 && (
        <Card>
          <SectionTitle>Props</SectionTitle>
          <PropTable rows={component.props.map((p) => ({ name: p.name, type: p.type, desc: p.description }))} />
        </Card>
      )}

      {/* Component-specific: state */}
      {component?.state && component.state.length > 0 && (
        <Card>
          <SectionTitle>React State ({component.state.length})</SectionTitle>
          <PropTable
            rows={component.state.map((s) => ({
              name: s.name,
              type: s.type ?? "inferred",
              desc: `default: ${s.defaultValue ?? "—"}${s.setter ? ` · setter: ${s.setter}()` : ""}${s.line ? ` · line ${s.line}` : ""}`,
            }))}
          />
        </Card>
      )}

      {/* Component-specific: hooks */}
      {component?.convexHooks && component.convexHooks.length > 0 && (
        <Card>
          <SectionTitle>Convex / React Hooks</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {component.convexHooks.map((h, i) => (
              <div key={i} style={{ fontSize: 11, fontFamily: T.mono }}>
                <Badge kind={h.hook.replace("use", "").toLowerCase()} />
                <span style={{ color: T.fn, marginLeft: 8 }}>{h.variable}</span>
                <span style={{ color: T.muted }}> = {h.hook}({h.target ?? ""})</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Component-specific: key functions */}
      {component?.keyFunctions && component.keyFunctions.length > 0 && (
        <Card>
          <SectionTitle>Key Functions</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {component.keyFunctions.map((kf) => (
              <div key={kf.name}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <Badge kind="function" />
                  <span style={{ color: T.fn, fontSize: 12.5, fontFamily: T.mono, fontWeight: 600 }}>{kf.name}</span>
                  <span style={{ color: T.muted, fontSize: 10, fontFamily: T.mono }}>:L{kf.line}</span>
                </div>
                {kf.keyCode && <CodeBlock code={kf.keyCode} />}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Component-specific: intro sequences */}
      {component?.keySequences && component.keySequences.length > 0 && (
        <Card>
          <SectionTitle>Animation Sequence</SectionTitle>
          <PropTable rows={component.keySequences.map((s) => ({ name: s.phase, type: s.timing, desc: s.css }))} />
        </Card>
      )}

      {/* CSS classes */}
      {file.cssClasses && file.cssClasses.length > 0 && (
        <Card>
          <SectionTitle>CSS Classes ({file.cssClasses.length})</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {file.cssClasses.map((c) => (
              <div key={c.name} style={{ background: "rgba(0,0,0,0.3)", borderRadius: 8, padding: 10 }}>
                <span style={{ color: T.gold, fontSize: 11.5, fontFamily: T.mono }}>{c.name}</span>
                {c.keyProperties && c.keyProperties.length > 0 && (
                  <div style={{ marginTop: 4 }}>
                    {c.keyProperties.map((p, i) => (
                      <div key={i} style={{ color: T.muted, fontSize: 10.5, fontFamily: T.mono, paddingLeft: 10 }}>
                        {p};
                      </div>
                    ))}
                  </div>
                )}
                {cssUsage && cssUsage.name === c.name && cssUsage.usedBy && cssUsage.usedBy.length > 0 && (
                  <div style={{ color: T.heading, fontSize: 10, fontFamily: T.mono, marginTop: 4 }}>
                    used by: {cssUsage.usedBy.join(", ")}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function PropTable({ rows }: { rows: { name: string; type: string; desc: string }[] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
        <thead>
          <tr>
            {["Name", "Type", "Details"].map((h) => (
              <th
                key={h}
                style={{
                  textAlign: "left",
                  color: T.heading,
                  fontSize: 10,
                  fontFamily: T.mono,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  padding: "6px 8px",
                  borderBottom: "1px solid rgba(139,92,246,0.2)",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.name + i} style={{ borderBottom: "1px solid rgba(139,92,246,0.08)" }}>
              <td style={{ padding: "6px 8px", color: T.fn, fontFamily: T.mono, whiteSpace: "nowrap" }}>{r.name}</td>
              <td style={{ padding: "6px 8px", color: T.cyan, fontFamily: T.mono, wordBreak: "break-all" }}>{r.type}</td>
              <td style={{ padding: "6px 8px", color: T.muted }}>{r.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
