"use client";

import { useFormStatus } from "react-dom";

import { cn } from "@/lib/utils";

/** Submits its form. The hidden fields beside it carry the new value. */
export function ToggleSwitch({ checked, label }: { checked: boolean; label: string }) {
  // Form-scoped status: every switch locks while any one change is in flight.
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={pending}
      className={cn(
        "flex h-6 w-12 items-center rounded-full p-0.5 transition-colors disabled:opacity-50",
        checked ? "justify-end bg-primary" : "justify-start bg-rule"
      )}
    >
      <span className="size-5 rounded-full bg-field" />
    </button>
  );
}
