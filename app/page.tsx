import Header from "@/components/Header";
import SpecFinderApp from "@/components/SpecFinderApp";

export default function Home() {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-white">
      <Header />
      <main className="flex flex-1 flex-col">
        <SpecFinderApp />
      </main>
    </div>
  );
}
