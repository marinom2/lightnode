import Link from "next/link";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-5 py-24 text-center">
      <span className="mb-5 grid size-14 place-items-center rounded-2xl bg-gradient-primary text-white">
        <Compass className="size-6" />
      </span>
      <h1 className="text-3xl font-semibold tracking-tight text-content-primary">Page not found</h1>
      <p className="mt-2 text-content-soft">That route doesn&apos;t exist. Let&apos;s get you back on track.</p>
      <div className="mt-6 flex gap-3">
        <Link href="/">
          <Button variant="gradient">Home</Button>
        </Link>
        <Link href="/onboard">
          <Button variant="outline">Become a worker</Button>
        </Link>
      </div>
    </div>
  );
}
