export default function WaveDivider() {
  return (
    <div className="w-full overflow-hidden leading-none" aria-hidden="true">
      <svg
        viewBox="0 0 1440 110"
        preserveAspectRatio="none"
        className="block w-full h-[70px] sm:h-[100px]"
      >
        <path
          d="M0,40 C240,90 480,0 720,30 C960,60 1200,0 1440,40 L1440,110 L0,110 Z"
          fill="#E0F7F4"
        />
        <path
          d="M0,60 C240,20 480,100 720,60 C960,20 1200,90 1440,60 L1440,110 L0,110 Z"
          fill="#E3F2FD"
        />
      </svg>
    </div>
  );
}
