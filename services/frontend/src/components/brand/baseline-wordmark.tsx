import { cn } from "@/lib/utils";

/**
 * The header wordmark: live text in the nav's face, sitting on a green rule
 * exactly as wide as the word. The rule is drawn like the active tab's bar, so
 * the two share one line, and the lane arc rises from it under the word. The
 * parent link is named "Baseline".
 */
export function BaselineWordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        // items-end seats the word on the rule; the padding clears the arc.
        "relative inline-flex h-full items-end pb-[var(--ct-header-wordmark-pb)] font-sans text-[24px] leading-none font-semibold tracking-[-0.02em] text-foreground shadow-[inset_0_-3px_0_0_var(--ct-accent)]",
        className
      )}
    >
      Baseline
      <svg
        aria-hidden="true"
        viewBox="0 0 36 14"
        width={36}
        height={14}
        className="pointer-events-none absolute bottom-[3px] left-1/2 -translate-x-1/2 overflow-visible"
      >
        <path
          d="M1.25 14 A17.4 17.4 0 0 1 34.75 14"
          stroke="var(--ct-accent)"
          strokeWidth={2.5}
          strokeLinecap="butt"
          fill="none"
        />
      </svg>
    </span>
  );
}
