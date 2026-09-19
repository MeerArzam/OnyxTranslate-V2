import { useState, useEffect } from "react";

/**
 * DragonIntro — Uses the actual Kali Linux dragon logo.svg
 * with neon glow effects on a black background.
 *
 * Sequence (~3.5s):
 *   1. Dark Reveal: Radial purple glow + gold ember particles
 *   2. Logo Appears: logo.svg fades in with purple/neon glow filter
 *   3. Flash Sweep: Left-to-right gold/white gradient bar
 *   4. Title: "ONYX" + "TRANSLATE" fade in below
 *   5. Fade Out: Everything dissolves, app appears
 */
export default function DragonIntro({
  onComplete,
}: {
  onComplete: () => void;
}) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      onComplete();
    }, 3700);
    return () => clearTimeout(timer);
  }, [onComplete]);

  // Safety: force-complete after 4.5s
  useEffect(() => {
    const safety = setTimeout(() => {
      setVisible(false);
      onComplete();
    }, 4500);
    return () => clearTimeout(safety);
  }, [onComplete]);

  if (!visible) return null;

  return (
    <div className="kali-overlay" aria-hidden="true">
      {/* Background radial glow */}
      <div className="kali-glow" />

      {/* Ember particles */}
      <div className="kali-ember" style={{ left: "15%", animationDelay: "0.0s", animationDuration: "2.8s" }} />
      <div className="kali-ember" style={{ left: "30%", animationDelay: "0.4s", animationDuration: "3.1s" }} />
      <div className="kali-ember" style={{ left: "45%", animationDelay: "0.8s", animationDuration: "2.6s" }} />
      <div className="kali-ember" style={{ left: "55%", animationDelay: "0.2s", animationDuration: "3.0s" }} />
      <div className="kali-ember" style={{ left: "70%", animationDelay: "0.6s", animationDuration: "2.9s" }} />
      <div className="kali-ember" style={{ left: "82%", animationDelay: "1.0s", animationDuration: "3.2s" }} />
      <div className="kali-ember" style={{ left: "25%", animationDelay: "1.2s", animationDuration: "2.7s" }} />
      <div className="kali-ember" style={{ left: "60%", animationDelay: "0.3s", animationDuration: "3.0s" }} />

      {/* The actual Kali Linux dragon logo with neon glow */}
      <div className="kali-logo-wrap">
        <img src="/logo.svg" alt="Onyx Translate Dragon" />
      </div>

      {/* Flash sweep bar */}
      <div className="kali-flash" />

      {/* Title */}
      <div className="kali-title-block">
        <div className="kali-title">ONYX</div>
        <div className="kali-subtitle">TRANSLATE</div>
      </div>
    </div>
  );
}
