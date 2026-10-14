import { cn } from "@/lib/utils";

/** A ruled heading over a block of the admin page, with an optional short note. */
export function Section({
  title,
  note,
  noteAlign = "end",
  children,
}: {
  title: string;
  note?: string;
  /** `end` pushes the note to the far edge; `inline` keeps it beside the title. */
  noteAlign?: "end" | "inline";
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div
        className={cn(
          "flex items-baseline gap-3 border-b border-rule-strong pb-2",
          noteAlign === "end" && "justify-between"
        )}
      >
        <h2 className="type-module">{title}</h2>
        {note ? <span className="text-sm text-ink-3">{note}</span> : null}
      </div>
      {children}
    </section>
  );
}
