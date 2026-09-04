import { useState, useEffect } from "react";

/**
 * DragonIntro — Kali Linux-style profile dragon intro.
 *
 * 4 phases over ~3.5 seconds:
 *   1. Dark Reveal (0–1s): Radial glow + ember particles
 *   2. Dragon Appears (0.8–2s): SVG profile dragon fades in
 *   3. Flash Sweep (1.5–2.5s): Left-to-right gradient bar
 *   4. Title (2–3s): "ONYX" + "TRANSLATE"
 *   5. Fade Out (3–3.5s): Everything dissolves
 *
 * Plays on every page refresh.
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

      {/* Ember particles (8 small gold dots drifting up) */}
      <div className="kali-ember" style={{ left: "15%", animationDelay: "0.0s", animationDuration: "2.8s" }} />
      <div className="kali-ember" style={{ left: "30%", animationDelay: "0.4s", animationDuration: "3.1s" }} />
      <div className="kali-ember" style={{ left: "45%", animationDelay: "0.8s", animationDuration: "2.6s" }} />
      <div className="kali-ember" style={{ left: "55%", animationDelay: "0.2s", animationDuration: "3.0s" }} />
      <div className="kali-ember" style={{ left: "70%", animationDelay: "0.6s", animationDuration: "2.9s" }} />
      <div className="kali-ember" style={{ left: "82%", animationDelay: "1.0s", animationDuration: "3.2s" }} />
      <div className="kali-ember" style={{ left: "25%", animationDelay: "1.2s", animationDuration: "2.7s" }} />
      <div className="kali-ember" style={{ left: "60%", animationDelay: "0.3s", animationDuration: "3.0s" }} />

      {/* Kali Linux-style profile dragon SVG */}
      <div className="kali-dragon-wrap">
        <svg
          viewBox="0 0 500 400"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="kali-dragon-svg"
        >
          <defs>
            <linearGradient id="kBody" x1="250" y1="50" x2="250" y2="350" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#E8E8E8" />
              <stop offset="100%" stopColor="#888888" />
            </linearGradient>
            <filter id="kGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor="#8B5CF6" floodOpacity="0.45" />
            </filter>
          </defs>

          {/* === BODY: Profile-facing dragon (head right, three horns up-left) === */}
          <g filter="url(#kGlow)">
            {/* Head — angular snout facing right */}
            <path
              d="M 310,155 C 320,140 340,135 360,138 C 370,140 380,148 375,158
                 C 370,168 350,172 340,170 C 330,168 315,162 310,155Z"
              fill="url(#kBody)"
            />
            {/* Eye */}
            <circle cx="348" cy="150" r="5" fill="#E53935" opacity="0.9">
              <animate attributeName="opacity" values="0.9;0.6;0.9" dur="2s" repeatCount="indefinite" />
            </circle>

            {/* Neck — curves down from head */}
            <path
              d="M 310,155 C 290,175 260,195 230,210
                 C 220,215 215,220 220,230
                 C 225,240 240,245 260,235
                 C 280,225 300,200 310,180Z"
              fill="url(#kBody)"
              opacity="0.85"
            />

            {/* Body — extends left and downward from neck */}
            <path
              d="M 230,210 C 200,225 170,240 145,255
                 C 130,265 125,280 135,290
                 C 145,300 170,295 190,280
                 C 210,265 225,245 230,230Z"
              fill="url(#kBody)"
              opacity="0.75"
            />

            {/* === THREE HORNS (most distinctive Kali feature) === */}
            {/* Horn 1 — longest, most leftward */}
            <path
              d="M 260,185 C 245,155 220,110 205,70
                 C 210,75 225,100 235,130
                 C 240,145 250,165 260,180Z"
              fill="#C0C0C0"
              opacity="0.9"
            />
            {/* Horn 2 — middle */}
            <path
              d="M 280,175 C 268,140 248,95 235,55
                 C 240,60 255,90 265,120
                 C 270,135 275,155 280,170Z"
              fill="#C8C8C8"
              opacity="0.85"
            />
            {/* Horn 3 — closest to head, shortest */}
            <path
              d="M 300,165 C 290,130 275,85 265,45
                 C 270,50 282,80 290,110
                 C 295,125 298,145 300,162Z"
              fill="#D0D0D0"
              opacity="0.8"
            />

            {/* === TAIL — curves down-right from body === */}
            <path
              d="M 135,290 C 120,310 105,330 90,350
                 C 85,360 88,370 95,368
                 C 102,366 115,345 125,325
                 C 132,310 135,298 135,290Z"
              fill="url(#kBody)"
              opacity="0.6"
            />
            {/* Second tail curve */}
            <path
              d="M 125,325 C 115,340 100,355 85,370
                 C 80,378 82,385 88,382
                 C 94,379 108,360 118,342
                 C 122,335 124,330 125,325Z"
              fill="#999999"
              opacity="0.5"
            />

            {/* === LEGS — two trailing lines === */}
            {/* Front leg */}
            <path
              d="M 185,275 C 175,295 170,315 168,335
                 C 167,340 170,342 173,338
                 C 176,330 178,315 182,300
                 C 184,290 185,280 185,275Z"
              fill="#AAAAAA"
              opacity="0.6"
            />
            {/* Back leg */}
            <path
              d="M 155,265 C 148,285 145,305 143,325
                 C 142,330 145,332 148,328
                 C 151,320 152,305 154,290
                 C 155,280 155,272 155,265Z"
              fill="#AAAAAA"
              opacity="0.55"
            />

            {/* Jaw detail — sharp angular V */}
            <path
              d="M 345,162 L 355,170 L 365,160"
              stroke="#999999"
              strokeWidth="1.5"
              fill="none"
              strokeLinecap="round"
              opacity="0.6"
            />

            {/* Nostril */}
            <circle cx="370" cy="148" r="2" fill="#777777" opacity="0.5" />

            {/* Wing membrane — angular, extending left from body */}
            <path
              d="M 200,230 C 180,215 155,195 130,180
                 C 120,175 115,178 122,188
                 C 130,198 148,210 168,222
                 C 178,228 190,230 200,230Z"
              fill="#777777"
              opacity="0.35"
            />
            {/* Wing joint spike */}
            <path
              d="M 165,200 C 155,185 140,165 128,148
                 C 132,155 145,175 158,192
                 C 162,197 164,200 165,200Z"
              fill="#999999"
              opacity="0.3"
            />
          </g>
        </svg>
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
