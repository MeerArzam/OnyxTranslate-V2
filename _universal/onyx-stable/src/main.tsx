import { StrictMode, useState, useCallback, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import Translator from "./pages/Translator.tsx";
import DragonIntro from "./components/DragonIntro.tsx";
import { lazy, Suspense } from "react";

// Overview dashboard is lazy-loaded — never bloats the main bundle
const Overview = lazy(() => import("./pages/Overview.tsx"));

import "./index.css";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL!);

/** Hash-based routing: #/overview → docs dashboard, everything else → Translator */
function useHashRoute(): string {
  const get = () => window.location.hash || "#/";
  const [hash, setHash] = useState(get);
  useEffect(() => {
    const onChange = () => setHash(get());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

function App() {
  const hash = useHashRoute();
  const isOverview = hash.startsWith("#/overview");

  const [showIntro, setShowIntro] = useState(true);
  const [showDebugBtn, setShowDebugBtn] = useState(false);

  // ?debug=1 shows a floating "Play Intro" button
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("debug") === "1") {
      setShowDebugBtn(true);
    }
  }, []);

  const handleIntroComplete = useCallback(() => {
    setShowIntro(false);
  }, []);

  const handleReplayIntro = useCallback(() => {
    setShowIntro(true);
  }, []);

  return (
    <>
      {/* Intro overlay — plays on top of the app, does not block rendering */}
      {showIntro && !isOverview && <DragonIntro onComplete={handleIntroComplete} />}

      {/* Hash routing: #/overview → docs dashboard, #/ → translator */}
      {isOverview ? (
        <Suspense
          fallback={
            <div
              style={{
                minHeight: "100vh",
                background: "#0a0a0f",
                color: "#8B5CF6",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "ui-monospace, monospace",
                fontSize: 13,
              }}
            >
              Loading documentation…
            </div>
          }
        >
          <Overview />
        </Suspense>
      ) : (
        <Translator />
      )}

      {/* Debug button: visible only with ?debug=1 */}
      {showDebugBtn && !isOverview && (
        <button
          onClick={handleReplayIntro}
          style={{
            position: "fixed",
            bottom: 12,
            left: 12,
            zIndex: 99999,
            padding: "6px 12px",
            fontSize: 11,
            background: "rgba(0,0,0,0.8)",
            color: "#fbbf24",
            border: "1px solid rgba(251,191,36,0.3)",
            borderRadius: 6,
            cursor: "pointer",
            opacity: 0.7,
          }}
          title="Replay the Dragon intro"
        >
          ▶ Play Intro
        </button>
      )}
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConvexProvider client={convex}>
      <App />
    </ConvexProvider>
  </StrictMode>,
);
