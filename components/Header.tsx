import Logo from "./Logo";

export default function Header() {
  return (
    <header className="w-full bg-white border-b border-light-blue">
      <div className="mx-auto max-w-5xl px-6 py-4 flex items-center gap-3">
        <Logo />
        <div className="flex flex-col leading-tight">
          <span className="text-xl font-bold text-navy tracking-tight">
            UFT
          </span>
          <span className="text-xs text-secondary">
            United Flow Technologies
          </span>
        </div>
      </div>
    </header>
  );
}
