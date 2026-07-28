import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Translator from "./pages/Translator.tsx";
import "./index.css";

// Lightweight web tool - no auth, no toolbar, no routing overhead
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Translator />
  </StrictMode>,
);