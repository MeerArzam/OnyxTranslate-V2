import { StrictMode, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import Translator from "./pages/Translator.tsx";
import IntroAnimation from "./components/IntroAnimation.tsx";
import "./index.css";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL!);

function App() {
  const [showIntro, setShowIntro] = useState(() => {
    // Skip intro if already seen in this tab
    if (typeof window !== "undefined" && sessionStorage.getItem("onyx-intro-seen")) {
      return false;
    }
    return true;
  });

  const handleIntroComplete = useCallback(() => {
    sessionStorage.setItem("onyx-intro-seen", "true");
    setShowIntro(false);
  }, []);

  return (
    <>
      {showIntro && <IntroAnimation onComplete={handleIntroComplete} />}
      <Translator />
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
