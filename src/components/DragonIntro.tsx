import { useState, useEffect } from "react";

/**
 * DragonIntro — Kali Linux-style fierce dragon intro for OnyxTranslate.
 *
 * 4 phases over ~5 seconds:
 *   1. Terminal boot (0–1.5s): Matrix-green text lines type in
 *   2. Dragon reveal (1.5–3s): Geometric CSS-clip-path dragon silhouette
 *   3. Title slam (3–4s): "ONYX" slams down, "TRANSLATE" types in
 *   4. Glitch + fade (4–5s): RGB split glitch, then dissolve
 *
 * Plays on every page refresh. ?debug=1 shows a replay button.
 */
export default function DragonIntro({ onComplete }: { onComplete: () => void }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      onComplete();
    }, 5200);
    return () => clearTimeout(timer);
  }, [onComplete]);

  // Safety: force-complete after 6s even if timer fails
  useEffect(() => {
    const safety = setTimeout(() => {
      setVisible(false);
      onComplete();
    }, 6000);
    return () => clearTimeout(safety);
  }, [onComplete]);

  if (!visible) return null;

  return (
    <div className="dragon-intro" aria-hidden="true">
      {/* Phase 1: Terminal boot lines */}
      <div className="dragon-terminal">
        <div className="line">[  OK  ] Loading Onyx kernel...</div>
        <div className="line">[  OK  ] Initializing translation engine...</div>
        <div className="line">[  OK  ] Connecting to Gemini neural network...</div>
        <div className="line">[  OK  ] 23-phase localization protocols loaded</div>
        <div className="line">[  OK  ] Onyx Translate v2.0 ready<span className="blink">█</span></div>
      </div>

      {/* Phase 2: Geometric dragon silhouette */}
      <div className="dragon-silhouette">
        <div className="dragon-horn-left" />
        <div className="dragon-horn-right" />
        <div className="dragon-head" />
        <div className="dragon-eye" />
        <div className="dragon-jaw" />
        <div className="dragon-wing-left" />
        <div className="dragon-wing-right" />
        <div className="dragon-body" />
        <div className="dragon-tail" />
      </div>

      {/* Phase 3: Title slam */}
      <div className="dragon-title glitch">
        <div className="onyx">ONYX</div>
        <div className="title-line" />
        <div className="translate-sub">TRANSLATE</div>
      </div>
    </div>
  );
}
