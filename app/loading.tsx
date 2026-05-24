import { Cpu } from "lucide-react";

export default function Loading() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-content-soft">
      <span className="grid size-12 animate-pulse-dot place-items-center rounded-2xl bg-gradient-primary text-white">
        <Cpu className="size-5" />
      </span>
      <p className="text-sm">Loading...</p>
    </div>
  );
}
