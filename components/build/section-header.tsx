import type { LucideIcon } from "lucide-react";
import { IconChip } from "@/components/ui/icon-chip";

/**
 * Shared title row used by every section across the /build hub and its
 * sub-pages. Keeps spacing + tone consistent so a section on /build/sdks
 * looks identical to one on /build/network.
 */
export function SectionHeader({
  icon: Icon,
  title,
  blurb,
}: {
  icon: LucideIcon;
  title: string;
  blurb: string;
}) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <IconChip icon={Icon} size="md" />
      <div>
        <h2 className="text-base font-semibold tracking-tight text-content-primary">{title}</h2>
        <p className="text-xs text-content-soft">{blurb}</p>
      </div>
    </div>
  );
}
