export default function Loading() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-content-soft">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/lightnode_logo.svg" alt="LightNode" className="size-14 animate-pulse-dot" />
      <p className="text-sm">Loading...</p>
    </div>
  );
}
