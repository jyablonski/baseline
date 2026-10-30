"use client";

import { cn } from "@/lib/utils";

/** An on/off switch for page state. `label` names it for screen readers. */
export function Switch({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={cn(
        "flex h-5 w-10 items-center rounded-full p-0.5 transition-colors",
        checked ? "justify-end bg-primary" : "justify-start bg-rule"
      )}
    >
      <span className="size-4 rounded-full bg-field" />
    </button>
  );
}
