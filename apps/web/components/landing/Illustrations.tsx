// Flat, outlined illustrations for the landing (brand v2): one ink stroke, flat fills, no
// gradients. Decorative: every one is aria-hidden; the text around them carries the meaning.
import type { SVGProps } from "react";

type Props = SVGProps<SVGSVGElement>;

const INK = "var(--ink)";
const STROKE = { stroke: INK, strokeWidth: 4, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** Tilt's mascot: an ace of spades with eyes, slightly tilted. */
export function CardBuddy(props: Props) {
  return (
    <svg viewBox="0 0 200 240" aria-hidden="true" focusable="false" {...props}>
      <g transform="rotate(-8 100 120)">
        <rect x="40" y="20" width="120" height="180" rx="16" fill="var(--paper)" {...STROKE} />
        <text x="54" y="58" fontFamily="var(--font-caprasimo)" fontSize="30" fill={INK}>
          A
        </text>
        <path d="M60 66 c-8 -10 -14 -12 -14 -18 a7 7 0 0 1 14 -2 a7 7 0 0 1 14 2 c0 6 -6 8 -14 18z" fill={INK} />
        <ellipse cx="82" cy="112" rx="17" ry="22" fill="#fff" {...STROKE} />
        <ellipse cx="122" cy="112" rx="17" ry="22" fill="#fff" {...STROKE} />
        <circle cx="88" cy="118" r="8" fill={INK} />
        <circle cx="128" cy="118" r="8" fill={INK} />
        <path d="M84 152 q18 16 36 0" fill="none" {...STROKE} />
        <path d="M140 178 c-8 -10 -14 -12 -14 -18 a7 7 0 0 1 14 -2 a7 7 0 0 1 14 2 c0 6 -6 8 -14 18z" fill={INK} />
      </g>
    </svg>
  );
}

/** A casino chip seen from above. */
export function Chip({ fill = "var(--orange)", ...props }: Props & { fill?: string }) {
  return (
    <svg viewBox="0 0 120 120" aria-hidden="true" focusable="false" {...props}>
      <circle cx="60" cy="60" r="52" fill={fill} {...STROKE} />
      <circle cx="60" cy="60" r="36" fill="var(--paper)" {...STROKE} />
      {[0, 60, 120, 180, 240, 300].map((angle) => (
        <rect
          key={angle}
          x="54"
          y="8"
          width="12"
          height="18"
          rx="3"
          fill="var(--paper)"
          {...STROKE}
          strokeWidth={3}
          transform={`rotate(${angle} 60 60)`}
        />
      ))}
      <text x="60" y="70" textAnchor="middle" fontFamily="var(--font-anton)" fontSize="28" fill={INK}>
        $1
      </text>
    </svg>
  );
}

/** A die showing five. */
export function Die({ fill = "var(--sky)", ...props }: Props & { fill?: string }) {
  const pips: [number, number][] = [
    [36, 36],
    [84, 36],
    [60, 60],
    [36, 84],
    [84, 84],
  ];
  return (
    <svg viewBox="0 0 120 120" aria-hidden="true" focusable="false" {...props}>
      <rect x="10" y="10" width="100" height="100" rx="22" fill={fill} {...STROKE} />
      {pips.map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="9" fill={INK} />
      ))}
    </svg>
  );
}

/** A roulette wheel, simplified. */
export function Wheel(props: Props) {
  return (
    <svg viewBox="0 0 120 120" aria-hidden="true" focusable="false" {...props}>
      <circle cx="60" cy="60" r="52" fill="var(--paper)" {...STROKE} />
      {Array.from({ length: 12 }, (_, i) => (
        <path
          key={i}
          d="M60 60 L60 8 A52 52 0 0 1 86 15 Z"
          fill={i % 2 === 0 ? "var(--orange)" : "var(--ink)"}
          stroke={INK}
          strokeWidth={2}
          transform={`rotate(${i * 30} 60 60)`}
        />
      ))}
      <circle cx="60" cy="60" r="22" fill="var(--green)" {...STROKE} />
      <circle cx="60" cy="60" r="7" fill="var(--paper)" {...STROKE} strokeWidth={3} />
    </svg>
  );
}

/** Three slot reels showing sevens. */
export function Reels(props: Props) {
  return (
    <svg viewBox="0 0 160 120" aria-hidden="true" focusable="false" {...props}>
      <rect x="8" y="14" width="144" height="92" rx="16" fill="var(--pink)" {...STROKE} />
      {[26, 66, 106].map((x) => (
        <g key={x}>
          <rect x={x - 4} y="28" width="36" height="64" rx="8" fill="var(--paper)" {...STROKE} strokeWidth={3} />
          <text x={x + 14} y="74" textAnchor="middle" fontFamily="var(--font-anton)" fontSize="34" fill="var(--orange)">
            7
          </text>
        </g>
      ))}
    </svg>
  );
}

/** A mines board: hidden tiles, one gem found, one mine. */
export function Minefield(props: Props) {
  const cells = [0, 1, 2].flatMap((row) => [0, 1, 2].map((col) => ({ x: 36 + col * 32, y: 16 + row * 32 })));
  return (
    <svg viewBox="0 0 160 120" aria-hidden="true" focusable="false" {...props}>
      <rect x="28" y="8" width="104" height="104" rx="16" fill="var(--sky)" {...STROKE} />
      {cells.map(({ x, y }, i) => (
        <rect
          key={i}
          x={x}
          y={y}
          width="24"
          height="24"
          rx="6"
          fill={i === 4 ? "var(--yellow)" : "var(--paper)"}
          {...STROKE}
          strokeWidth={3}
        />
      ))}
      <path d="M112 52 l8 8 l-8 8 l-8 -8 z" fill="var(--green)" {...STROKE} strokeWidth={2.5} />
      <circle cx="80" cy="60" r="7" fill="var(--orange)" {...STROKE} strokeWidth={2.5} />
    </svg>
  );
}

/** Two baccarat cards, fanned. */
export function Fan(props: Props) {
  return (
    <svg viewBox="0 0 140 120" aria-hidden="true" focusable="false" {...props}>
      <rect
        x="18"
        y="20"
        width="60"
        height="88"
        rx="10"
        fill="var(--paper)"
        {...STROKE}
        transform="rotate(-12 48 64)"
      />
      <rect x="58" y="14" width="60" height="88" rx="10" fill="var(--paper)" {...STROKE} transform="rotate(10 88 58)" />
      <text
        x="84"
        y="70"
        textAnchor="middle"
        fontFamily="var(--font-caprasimo)"
        fontSize="34"
        fill="var(--orange)"
        transform="rotate(10 88 58)"
      >
        9
      </text>
      <path d="M30 56 l6 -10 l6 10 l-6 10z" fill="var(--orange)" transform="rotate(-12 48 64)" />
    </svg>
  );
}

/** A friendly terminal: where Tilt lives. */
export function Terminal(props: Props) {
  return (
    <svg viewBox="0 0 160 120" aria-hidden="true" focusable="false" {...props}>
      <rect x="8" y="10" width="144" height="100" rx="14" fill="var(--ink)" {...STROKE} />
      <circle cx="26" cy="26" r="4" fill="var(--orange)" />
      <circle cx="40" cy="26" r="4" fill="var(--yellow)" />
      <circle cx="54" cy="26" r="4" fill="var(--green)" />
      <path
        d="M28 54 l14 12 l-14 12"
        fill="none"
        stroke="var(--yellow)"
        strokeWidth={5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M52 80 h40" stroke="var(--yellow)" strokeWidth={5} strokeLinecap="round" />
    </svg>
  );
}

/** A starburst sticker, for callouts. */
export function Burst({ fill = "var(--orange)", ...props }: Props & { fill?: string }) {
  const points = Array.from({ length: 24 }, (_, i) => {
    const r = i % 2 === 0 ? 56 : 44;
    const a = (i / 24) * Math.PI * 2;
    return `${(60 + r * Math.cos(a)).toFixed(1)},${(60 + r * Math.sin(a)).toFixed(1)}`;
  }).join(" ");
  return (
    <svg viewBox="0 0 120 120" aria-hidden="true" focusable="false" {...props}>
      <polygon points={points} fill={fill} {...STROKE} strokeWidth={3} />
    </svg>
  );
}
