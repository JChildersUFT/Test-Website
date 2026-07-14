type Props = {
  /** Flip vertically, for a wave that hangs from the top of a section. */
  flip?: boolean;
  /** Background for the transparent area above the wave (blend with the
   * section above the divider). */
  className?: string;
};

// Each path spans 0–2880 and repeats its wave every 720 units, so the pattern
// is identical at x=0, 1440 and 2880. The svg is rendered at 200% width and the
// paths drift left by 1440px (see .wave-flow-* in globals.css), giving a
// seamless, continuously flowing loop.
export default function WaveDivider({ flip = false, className = "" }: Props) {
  return (
    <div
      className={`w-full overflow-hidden leading-none ${flip ? "rotate-180" : ""} ${className}`}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 2880 110"
        preserveAspectRatio="none"
        className="block h-[70px] w-[200%] sm:h-[100px]"
      >
        <path
          className="wave-flow-slow"
          fill="#E0F7F4"
          d="M0,60 C180,30 540,90 720,60 C900,30 1260,90 1440,60 C1620,30 1980,90 2160,60 C2340,30 2700,90 2880,60 L2880,110 L0,110 Z"
        />
        <path
          className="wave-flow-fast"
          fill="#E3F2FD"
          d="M0,72 C240,42 480,102 720,72 C960,42 1200,102 1440,72 C1680,42 1920,102 2160,72 C2400,42 2640,102 2880,72 L2880,110 L0,110 Z"
        />
      </svg>
    </div>
  );
}
