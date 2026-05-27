"use client";

import { useEffect, useId, useState } from "react";

/**
 * A premium radial dial: a 270-degree gradient arc over a soft track, with
 * rounded caps, a glow, and a smooth fill animation on mount. Center content is
 * rendered via children. Used for the machine score and the Speed test result.
 */
export function RadialGauge({
  value,
  size = 168,
  stroke = 13,
  gradient = ["#7064e9", "#b06ae0"],
  sweep = 270,
  glow = true,
  children,
  className,
}: {
  /** 0..1 fraction of the arc to fill */
  value: number;
  size?: number;
  stroke?: number;
  /** [start, end] stroke gradient colors */
  gradient?: [string, string];
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
            <stop offset="0%" stopColor={gradient[0]} />
            <stop offset="100%" stopColor={gradient[1]} />
          </linearGradient>
        </defs>
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
            transition: "stroke-dashoffset 1s cubic-bezier(0.22, 1, 0.36, 1)",
            filter: glow ? `drop-shadow(0 0 6px ${gradient[1]}66)` : undefined,
          }}
        />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center" }}>
        {children}
      </div>
    </div>
  );
}
