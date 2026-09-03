import { StrictMode, useState, useCallback, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import Translator from "./pages/Translator.tsx";
import RoyalIntro, { forcePlayIntro } from "./components/RoyalIntro.tsx";
import "./index.css";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL!);

function App() {
  // ?intro=1 forces replay by clearing sessionStorage first
  const [showIntro, setShowIntro] = useState(() => {
    if (typeof window === "undefined") return false;
    const params = new URLSearchParams(window.location.search);
    if (params.get("intro") === "1") {
      sessionStorage.removeItem("onyx-intro-seen");
      return true;
    }
    return !sessionStorage.getItem("onyx-intro-seen");
  });

  const [showDebugBtn, setShowDebugBtn] = useState(false);

  // ?debug=1 shows a floating "Play Intro" button
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("debug") === "1") {
      setShowDebugBtn(true);
    }
  }, []);

  const handleIntroComplete = useCallback(() => {
    sessionStorage.setItem("onyx-intro-seen", "true");
    setShowIntro(false);
  }, []);

  const handleReplayIntro = useCallback(() => {
    forcePlayIntro();
    setShowIntro(true);
  }, []);

  return (
    <>
      {showIntro && <RoyalIntro onComplete={handleIntroComplete} />}
      <Translator />

      {/* Debug button: visible only with ?debug=1 */}
      {showDebugBtn && (
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
          title="Replay the Royal Dragon intro"
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
