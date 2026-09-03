import { useState, useEffect } from "react";

/**
 * DragonIntro — Kali Linux-style fierce dragon intro for OnyxTranslate.
 *
 * 5 phases over ~4 seconds:
 *   1. Terminal Boot (0–1.2s): Matrix-green text lines type in
 *   2. Dragon Emblem (1.0–2.5s): Front-facing geometric SVG dragon
 *   3. Flash Sweep (2.3–3.0s): Left-to-right gradient bar
 *   4. Title Reveal (2.8–3.5s): "ONYX" + "TRANSLATE"
 *   5. Fade Out (3.3–4.0s): Everything dissolves, app appears
 *
 * Plays on every page refresh. ?debug=1 shows a replay button.
 */
export default function DragonIntro({ onComplete }: { onComplete: () => void }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      onComplete();
    }, 4200);
    return () => clearTimeout(timer);
  }, [onComplete]);

  // Safety: force-complete after 5s even if timer fails
  useEffect(() => {
    const safety = setTimeout(() => {
      setVisible(false);
      onComplete();
    }, 5000);
    return () => clearTimeout(safety);
  }, [onComplete]);

  if (!visible) return null;

  return (
    <div className="di-overlay" aria-hidden="true">
      {/* Phase 1: Terminal boot lines */}
      <div className="di-terminal">
        <div className="di-term-line" style={{ animationDelay: "0.05s" }}>[  OK  ] Starting Onyx Translate...</div>
        <div className="di-term-line" style={{ animationDelay: "0.2s" }}>[  OK  ] Loading neural networks...</div>
        <div className="di-term-line" style={{ animationDelay: "0.35s" }}>[  OK  ] Initializing translation engine...</div>
        <div className="di-term-line" style={{ animationDelay: "0.5s" }}>[  OK  ] Connecting to Gemini 3.6 Flash...</div>
        <div className="di-term-line" style={{ animationDelay: "0.65s" }}>[  OK  ] System ready.<span className="di-blink">█</span></div>
      </div>

      {/* Phase 2: Front-facing geometric dragon SVG */}
      <div className="di-dragon-wrap">
        <svg
          viewBox="0 0 240 200"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="di-dragon-svg"
        >
          <defs>
            <linearGradient id="drgBody" x1="120" y1="40" x2="120" y2="180" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#E0E0E0" />
              <stop offset="100%" stopColor="#808080" />
            </linearGradient>
            <linearGradient id="drgWing" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#C0C0C0" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#606060" stopOpacity="0.6" />
            </linearGradient>
            <radialGradient id="drgEye">
              <stop offset="0%" stopColor="#FF0000" />
              <stop offset="60%" stopColor="#CC0000" />
              <stop offset="100%" stopColor="#800000" />
            </radialGradient>
            <filter id="drgGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#8B5CF6" floodOpacity="0.5" />
            </filter>
          </defs>

          {/* LEFT WING (viewer's left = dragon's right) */}
          <g className="di-wing-left">
            {/* Upper wing segment */}
            <polygon points="40,90 10,30 55,70" fill="url(#drgWing)" opacity="0.85" />
            {/* Mid wing segment */}
            <polygon points="40,90 10,30 5,70 30,95" fill="url(#drgWing)" opacity="0.6" />
            {/* Lower wing membrane */}
            <polygon points="30,95 5,70 15,110 40,105" fill="url(#drgWing)" opacity="0.45" />
            {/* Wing joint spike */}
            <polygon points="10,30 5,20 18,28" fill="#A0A0A0" opacity="0.7" />
          </g>

          {/* RIGHT WING (viewer's right = dragon's left) */}
          <g className="di-wing-right">
            <polygon points="200,90 230,30 185,70" fill="url(#drgWing)" opacity="0.85" />
            <polygon points="200,90 230,30 235,70 210,95" fill="url(#drgWing)" opacity="0.6" />
            <polygon points="210,95 235,70 225,110 200,105" fill="url(#drgWing)" opacity="0.45" />
            <polygon points="230,30 235,20 222,28" fill="#A0A0A0" opacity="0.7" />
          </g>

          {/* HEAD — front-facing, angular */}
          <polygon
            points="120,45 95,80 85,75 90,95 105,100 120,108 135,100 150,95 155,75 145,80"
            fill="url(#drgBody)"
            filter="url(#drgGlow)"
          />

          {/* HORN LEFT */}
          <polygon points="100,55 88,15 108,50" fill="#B0B0B0" opacity="0.85" />
          {/* HORN RIGHT */}
          <polygon points="140,55 152,15 132,50" fill="#B0B0B0" opacity="0.85" />

          {/* SNOUT — angular V shape */}
          <polygon points="120,108 110,118 115,115 120,125 125,115 130,118" fill="#707070" />

          {/* EYE LEFT */}
          <circle cx="107" cy="72" r="5" fill="url(#drgEye)" className="di-eye" />
          {/* EYE RIGHT */}
          <circle cx="133" cy="72" r="5" fill="url(#drgEye)" className="di-eye" />

          {/* BROW RIDGES */}
          <line x1="98" y1="62" x2="112" y2="65" stroke="#909090" strokeWidth="2" strokeLinecap="round" />
          <line x1="142" y1="62" x2="128" y2="65" stroke="#909090" strokeWidth="2" strokeLinecap="round" />

          {/* NECK / BODY below head */}
          <polygon points="105,100 95,140 120,155 145,140 135,100" fill="url(#drgBody)" opacity="0.7" />

          {/* BODY SCALE LINES */}
          <line x1="108" y1="120" x2="132" y2="120" stroke="#909090" strokeWidth="1" opacity="0.4" />
          <line x1="103" y1="132" x2="137" y2="132" stroke="#909090" strokeWidth="1" opacity="0.3" />
          <line x1="100" y1="144" x2="140" y2="144" stroke="#909090" strokeWidth="1" opacity="0.2" />

          {/* CLAW LEFT */}
          <line x1="92" y1="140" x2="85" y2="155" stroke="#A0A0A0" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="95" y1="142" x2="90" y2="158" stroke="#A0A0A0" strokeWidth="1.5" strokeLinecap="round" />
          {/* CLAW RIGHT */}
          <line x1="148" y1="140" x2="155" y2="155" stroke="#A0A0A0" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="145" y1="142" x2="150" y2="158" stroke="#A0A0A0" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>

      {/* Phase 3: Flash sweep bar */}
      <div className="di-flash-sweep" />

      {/* Phase 4: Title */}
      <div className="di-title-block">
        <div className="di-title">ONYX</div>
        <div className="di-title-line" />
        <div className="di-subtitle">TRANSLATE</div>
      </div>
    </div>
  );
}
