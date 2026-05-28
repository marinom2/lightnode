"use client";

import { useEffect, useId, useState } from "react";

// The signature LightNode spectrum (same stops as the gradient/contrast buttons:
// magenta → purple → indigo → blue). One fixed multi-stop gradient fills the arc
// regardless of value; the fill fraction conveys the value and the number/label
// carry "how good", so the colour never has to change with the score.
const BRAND_SPECTRUM = ["#dd00ac", "#7130c3", "#7064e9", "#4f7cf6"];

/**
 * A premium radial dial: a 270-degree multi-stop gradient arc over a soft track,
 * with rounded caps, a glow, and a smooth fill animation on mount. Center content
 * is rendered via children. Used for the machine score and the Speed test result.
 */
export function RadialGauge({
  value,
  size = 168,
  stroke = 14,
  gradient = BRAND_SPECTRUM,
  sweep = 270,
  glow = true,
  children,
  className,
}: {
  /** 0..1 fraction of the arc to fill */
  value: number;
  size?: number;
  stroke?: number;
  /** stroke gradient color stops (2+), spread evenly along the arc */
  gradient?: string[];
  /** arc length in degrees (270 = dial with a gap at the bottom) */
  sweep?: number;
  glow?: boolean;
  children?: React.ReactNode;
  className?: string;
}) {
  const id = useId();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const arc = (sweep / 360) * c;
  const clamped = Math.max(0, Math.min(1, value));
  const stops = gradient.length >= 2 ? gradient : [gradient[0] ?? BRAND_SPECTRUM[0], gradient[0] ?? BRAND_SPECTRUM[3]];
  const glowColor = stops[stops.length - 1];

  // Animate from empty to the target on mount / when the value changes.
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const t = requestAnimationFrame(() => setShown(clamped));
    return () => cancelAnimationFrame(t);
  }, [clamped]);

  // Rotate so the 90deg gap is centered at the bottom.
  const rotation = 90 + (360 - sweep) / 2;

  return (
    <div className={className} style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: `rotate(${rotation}deg)` }}>
        <defs>
          <linearGradient id={`g-${id}`} x1="0%" y1="0%" x2="100%" y2="100%">
            {stops.map((color, i) => (
              <stop key={i} offset={`${(i / (stops.length - 1)) * 100}%`} stopColor={color} />
            ))}
          </linearGradient>
        </defs>
        {/* soft track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--surface-base-faint)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${arc} ${c}`}
        />
        {/* gradient value arc */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#g-${id})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${arc} ${c}`}
          strokeDashoffset={arc * (1 - shown)}
          style={{
            transition: "stroke-dashoffset 1.1s cubic-bezier(0.22, 1, 0.36, 1)",
            filter: glow ? `drop-shadow(0 0 8px ${glowColor}59)` : undefined,
          }}
        />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center" }}>
        {children}
      </div>
    </div>
  );
}
