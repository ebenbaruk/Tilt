// The TILT wordmark with wavy vertical strokes. A turbulence that only varies along y shifts
// each row of pixels sideways, so straight stems become waves. Decorative: the heading text
// next to it carries the name for assistive tech.

interface Props {
  /** Unique per page: SVG filter ids are global. */
  id: string;
  className?: string;
}

export function WavyWordmark({ id, className }: Props) {
  const filter = `wave-${id}`;
  return (
    <svg className={className} viewBox="0 0 1000 470" aria-hidden="true" focusable="false">
      <defs>
        <filter id={filter} x="-4%" y="-4%" width="108%" height="108%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0 0.0065" numOctaves={1} seed={11} result="noise" />
          {/* Smooth the noise so stems bend in long waves instead of jittering. */}
          <feGaussianBlur in="noise" stdDeviation="0 6" result="smooth" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="smooth"
            scale={90}
            xChannelSelector="R"
            yChannelSelector="A"
            result="waved"
          />
          {/* Displacement samples without antialiasing: soften, then re-sharpen the edge. */}
          <feGaussianBlur in="waved" stdDeviation="1.2" result="soft" />
          <feComponentTransfer in="soft">
            <feFuncA type="linear" slope="3" intercept="-1" />
          </feComponentTransfer>
        </filter>
      </defs>
      <g filter={`url(#${filter})`}>
        {/* yChannelSelector="A" shifts everything down by scale/2: the baseline compensates. */}
        <text
          x="22"
          y="420"
          textLength="956"
          lengthAdjust="spacingAndGlyphs"
          fontFamily="var(--font-anton)"
          fontSize="560"
          fill="currentColor"
        >
          TILT
        </text>
      </g>
    </svg>
  );
}
