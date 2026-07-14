import Image from "next/image";
import Logo from "./Logo";
import heywardLogo from "@/images/Heyward_Logo.png";

export default function Header() {
  return (
    <header className="w-full bg-white border-b border-light-blue">
      <div className="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
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
        <Image
          src={heywardLogo}
          alt="Heyward — a UFT Company"
          className="h-7 w-auto sm:h-9"
          priority
        />
      </div>
    </header>
  );
}
