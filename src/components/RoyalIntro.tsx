import { useEffect, useRef, useState } from "react";

/**
 * RoyalIntro — Cinematic Netflix-style opening for OnyxTranslate.
 *
 * 5 acts over ~7 seconds:
 *   1. Herald (0–2s): Dark void → indigo gradient, stars + embers fade in
 *   2. The Dragons (1.5–3.5s): Two dragon silhouettes enter from edges
 *   3. The Crown (2.5–4.5s): Crown/sigil forms, dragons flank it
 *   4. Breath of Translation (4–5.5s): Fire sweep reveals ONYX TRANSLATE
 *   5. The Finale (5.5–7s): Flash → dissolve → app appears
 *
 * Plays on every page refresh. ?debug=1 shows a "Play Intro" button.
 */
export default function RoyalIntro({ onComplete }: { onComplete: () => void }) {
  const [mounted, setMounted] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Safety: force-unmount after 8s even if something breaks
  useEffect(() => {
    const safety = setTimeout(() => {
      setMounted(false);
      onComplete();
    }, 8000);
    timerRef.current.push(safety);
    return () => {
      timerRef.current.forEach(clearTimeout);
      clearTimeout(safety);
    };
  }, [onComplete]);

  // Normal completion at 7s
  useEffect(() => {
    const t = setTimeout(() => {
      setMounted(false);
      onComplete();
    }, 7200);
    timerRef.current.push(t);
    return () => clearTimeout(t);
  }, [onComplete]);

  if (!mounted) return null;

  return (
    <div className="ri-overlay" aria-hidden="true">
      {/* ─── Stars layer (Act 1) ─── */}
      <div className="ri-stars">
        {STARS.map((s, i) => (
          <div
            key={`s${i}`}
            className="ri-star"
            style={{
              left: s.x,
              top: s.y,
              width: s.size,
              height: s.size,
              animationDelay: `${s.delay}s`,
              animationDuration: `${s.dur}s`,
              background: s.color,
            }}
          />
        ))}
      </div>

      {/* ─── Ember particles (Act 1) ─── */}
      <div className="ri-embers">
        {EMBERS.map((e, i) => (
          <div
            key={`e${i}`}
            className="ri-ember"
            style={{
              left: e.x,
              bottom: e.y,
              animationDelay: `${e.delay}s`,
              animationDuration: `${e.dur}s`,
              width: e.size,
              height: e.size,
            }}
          />
        ))}
      </div>

      {/* ─── Faint center glow pulse (Act 1) ─── */}
      <div className="ri-center-pulse" />

      {/* ─── Left Dragon (Act 2) ─── */}
      <div className="ri-dragon ri-dragon-left">
        <svg viewBox="0 0 320 220" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="rdlBody" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#7c3aed" />
              <stop offset="60%" stopColor="#4c1d95" />
              <stop offset="100%" stopColor="#1e1b4b" />
            </linearGradient>
            <linearGradient id="rdlWing" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#7c3aed" stopOpacity="0.3" />
            </linearGradient>
            <radialGradient id="rdlEye">
              <stop offset="0%" stopColor="#fbbf24" />
              <stop offset="70%" stopColor="#f59e0b" />
              <stop offset="100%" stopColor="#d97706" />
            </radialGradient>
          </defs>
          {/* Body */}
          <path d="M40,140 Q55,125 70,118 Q90,108 105,102 Q118,96 130,90 Q140,85 148,78 L155,72 Q158,70 160,72 Q162,74 160,76 L150,88 Q145,93 140,98" fill="url(#rdlBody)" />
          {/* Wing top */}
          <path d="M85,105 Q70,72 58,48 Q52,38 48,32 Q46,28 50,30 Q60,36 72,52 Q82,66 88,100 Z" fill="url(#rdlWing)" />
          {/* Wing membrane */}
          <path d="M88,100 Q95,68 105,48 Q110,40 108,42 Q100,52 92,98 Z" fill="url(#rdlWing)" opacity="0.5" />
          {/* Tail */}
          <path d="M40,140 Q30,152 22,160 Q16,166 10,170 Q8,172 12,170 Q20,164 28,156 Q34,148 40,140 Z" fill="url(#rdlBody)" />
          {/* Tail spike */}
          <path d="M10,170 L4,165 L8,172 Z" fill="#a78bfa" opacity="0.6" />
          {/* Head */}
          <path d="M155,72 Q162,65 168,62 Q172,60 174,63 Q176,66 172,70 Q168,74 160,76 Z" fill="url(#rdlBody)" />
          {/* Horn */}
          <path d="M165,63 L162,50 L168,62 Z" fill="#c4b5fd" opacity="0.7" />
          {/* Eye glow */}
          <circle cx="170" cy="65" r="2.5" fill="url(#rdlEye)" className="ri-dragon-eye" />
          {/* Claws */}
          <path d="M92,112 L88,118 M95,114 L92,120 M98,115 L96,121" stroke="#a78bfa" strokeWidth="1.2" strokeLinecap="round" opacity="0.6" />
        </svg>
      </div>

      {/* ─── Right Dragon (Act 2, mirrored) ─── */}
      <div className="ri-dragon ri-dragon-right">
        <svg viewBox="0 0 320 220" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="rdrBody" x1="100%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#7c3aed" />
              <stop offset="60%" stopColor="#4c1d95" />
              <stop offset="100%" stopColor="#1e1b4b" />
            </linearGradient>
            <linearGradient id="rdrWing" x1="100%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#7c3aed" stopOpacity="0.3" />
            </linearGradient>
            <radialGradient id="rdrEye">
              <stop offset="0%" stopColor="#fbbf24" />
              <stop offset="70%" stopColor="#f59e0b" />
              <stop offset="100%" stopColor="#d97706" />
            </radialGradient>
          </defs>
          {/* Body */}
          <path d="M280,140 Q265,125 250,118 Q230,108 215,102 Q202,96 190,90 Q180,85 172,78 L165,72 Q162,70 160,72 Q158,74 160,76 L170,88 Q175,93 180,98" fill="url(#rdrBody)" />
          {/* Wing top */}
          <path d="M235,105 Q250,72 262,48 Q268,38 272,32 Q274,28 270,30 Q260,36 248,52 Q238,66 232,100 Z" fill="url(#rdrWing)" />
          {/* Wing membrane */}
          <path d="M232,100 Q225,68 215,48 Q210,40 212,42 Q220,52 228,98 Z" fill="url(#rdrWing)" opacity="0.5" />
          {/* Tail */}
          <path d="M280,140 Q290,152 298,160 Q304,166 310,170 Q312,172 308,170 Q300,164 292,156 Q286,148 280,140 Z" fill="url(#rdrBody)" />
          {/* Tail spike */}
          <path d="M310,170 L316,165 L312,172 Z" fill="#a78bfa" opacity="0.6" />
          {/* Head */}
          <path d="M165,72 Q158,65 152,62 Q148,60 146,63 Q144,66 148,70 Q152,74 160,76 Z" fill="url(#rdrBody)" />
          {/* Horn */}
          <path d="M155,63 L158,50 L152,62 Z" fill="#c4b5fd" opacity="0.7" />
          {/* Eye glow */}
          <circle cx="150" cy="65" r="2.5" fill="url(#rdrEye)" className="ri-dragon-eye" />
          {/* Claws */}
          <path d="M228,112 L232,118 M225,114 L228,120 M222,115 L224,121" stroke="#a78bfa" strokeWidth="1.2" strokeLinecap="round" opacity="0.6" />
        </svg>
      </div>

      {/* ─── Crown / Dragon Sigil (Act 3) ─── */}
      <div className="ri-crown">
        <svg viewBox="0 0 120 100" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="crownGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fbbf24" />
              <stop offset="50%" stopColor="#f59e0b" />
              <stop offset="100%" stopColor="#d97706" />
            </linearGradient>
            <linearGradient id="crownPurple" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#a78bfa" />
              <stop offset="100%" stopColor="#6d28d9" />
            </linearGradient>
          </defs>
          {/* Crown base */}
          <rect x="20" y="60" width="80" height="12" rx="3" fill="url(#crownGrad)" />
          {/* Crown band */}
          <rect x="18" y="68" width="84" height="8" rx="2" fill="url(#crownPurple)" />
          {/* Crown points */}
          <path d="M25,60 L20,35 L35,50 L45,28 L55,48 L60,22 L65,48 L75,28 L85,50 L100,35 L95,60 Z" fill="url(#crownGrad)" />
          {/* Jewels */}
          <circle cx="60" cy="30" r="4" fill="#f43f5e" opacity="0.9" />
          <circle cx="45" cy="40" r="2.5" fill="#818cf8" opacity="0.8" />
          <circle cx="75" cy="40" r="2.5" fill="#818cf8" opacity="0.8" />
          {/* Dragon sigil below crown */}
          <path d="M52,76 Q56,72 60,70 Q64,72 68,76 Q66,80 60,82 Q54,80 52,76 Z" fill="#fbbf24" opacity="0.7" />
          <circle cx="57" cy="75" r="1.2" fill="#1e1b4b" />
          <circle cx="63" cy="75" r="1.2" fill="#1e1b4b" />
        </svg>
      </div>

      {/* ─── Fire stream (Act 4) ─── */}
      <div className="ri-fire" />

      {/* ─── Golden sparkle trail (Act 4) ─── */}
      <div className="ri-sparkles">
        {SPARKLES.map((s, i) => (
          <div
            key={`sp${i}`}
            className="ri-sparkle"
            style={{
              top: s.y,
              animationDelay: `${s.delay}s`,
              animationDuration: `${s.dur}s`,
              width: s.size,
              height: s.size,
            }}
          />
        ))}
      </div>

      {/* ─── Title (Act 4) ─── */}
      <div className="ri-title-block">
        <div className="ri-title">ONYX</div>
        <div className="ri-ornament-line" />
        <div className="ri-subtitle">TRANSLATE</div>
      </div>

      {/* ─── Gold-white flash (Act 5) ─── */}
      <div className="ri-flash" />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Data arrays for stars, embers, sparkles
   ═══════════════════════════════════════════════════════════════════════ */

const STARS = Array.from({ length: 24 }, (_, i) => ({
  x: `${4 + ((i * 37 + 13) % 92)}%`,
  y: `${3 + ((i * 53 + 7) % 88)}%`,
  size: `${1 + (i % 3)}px`,
  delay: (i * 0.12) % 1.5,
  dur: 2 + (i % 4) * 0.5,
  color: i % 4 === 0 ? "rgba(234,179,8,0.6)" : i % 3 === 0 ? "rgba(167,139,250,0.5)" : "rgba(255,255,255,0.4)",
}));

const EMBERS = Array.from({ length: 16 }, (_, i) => ({
  x: `${8 + ((i * 43 + 11) % 84)}%`,
  y: `${2 + ((i * 7 + 3) % 15)}%`,
  size: `${2 + (i % 2)}px`,
  delay: 0.3 + (i * 0.18) % 2.0,
  dur: 2.5 + (i % 3) * 0.8,
}));

const SPARKLES = Array.from({ length: 12 }, (_, i) => ({
  y: `${42 + ((i * 13 + 5) % 16)}%`,
  delay: 4.0 + (i * 0.1),
  dur: 0.6 + (i % 3) * 0.2,
  size: `${2 + (i % 3)}px`,
}));

/* ═══════════════════════════════════════════════════════════════════════
   Helper: force replay from outside
   ═══════════════════════════════════════════════════════════════════════ */
export function forcePlayIntro() {
  sessionStorage.removeItem("onyx-intro-seen");
}
