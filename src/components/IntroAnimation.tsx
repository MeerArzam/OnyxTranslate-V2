import { useEffect, useState } from "react";

export default function IntroAnimation({ onComplete }: { onComplete: () => void }) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    // Phase 1: particles fade in (0-1s)
    const t1 = setTimeout(() => setPhase(1), 0);
    // Phase 2: ring appears (1s)
    const t2 = setTimeout(() => setPhase(2), 1000);
    // Phase 3: text reveals (2s)
    const t3 = setTimeout(() => setPhase(3), 2000);
    // Phase 4: burst + unmount (3.5s)
    const t4 = setTimeout(() => {
      onComplete();
    }, 3500);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
    };
  }, [onComplete]);

  if (phase === 0 && typeof document !== "undefined") {
    // Immediately skip if already seen
    if (sessionStorage.getItem("onyx-intro-seen")) {
      return null;
    }
  }

  return (
    <div className="intro-overlay" aria-hidden="true">
      {/* Particles — CSS-only, positioned absolutely */}
      {Array.from({ length: 20 }).map((_, i) => (
        <div
          key={i}
          className="intro-particle"
          style={{
            left: `${5 + Math.random() * 90}%`,
            top: `${5 + Math.random() * 90}%`,
            animationDelay: `${Math.random() * 3}s`,
            animationDuration: `${2 + Math.random() * 2}s`,
            width: `${1 + Math.random() * 2}px`,
            height: `${1 + Math.random() * 2}px`,
            background:
              i % 3 === 0
                ? "rgba(234, 179, 8, 0.5)"
                : "rgba(139, 92, 246, 0.5)",
          }}
        />
      ))}

      {/* Ring */}
      {phase >= 1 && <div className="intro-ring" />}

      {/* Text */}
      {phase >= 2 && (
        <div className="intro-text-container">
          <div className="intro-title">ONYX</div>
          <div className="intro-subtitle">TRANSLATE</div>
        </div>
      )}
    </div>
  );
}
