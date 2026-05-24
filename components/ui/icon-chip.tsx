import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Size = "sm" | "md" | "lg";

const box: Record<Size, string> = { sm: "size-8", md: "size-10", lg: "size-12" };
const ic: Record<Size, string> = { sm: "size-4", md: "size-5", lg: "size-6" };

/** Premium gradient icon chip (white icon on the brand gradient) - the
 *  "How it works" treatment, used consistently across the app. */
export function IconChip({
  icon: Icon,
  size = "md",
  className,
}: {
  icon: LucideIcon;
  size?: Size;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-xl bg-gradient-primary text-white shadow-[0_6px_16px_-6px_rgba(112,100,233,0.6)]",
        box[size],
        className,
      )}
    >
      <Icon className={ic[size]} />
    </span>
  );
}
