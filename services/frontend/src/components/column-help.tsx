"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** A column heading that explains itself in a popover when pressed. */
export function ColumnHelp({
  label,
  title,
  align,
  className,
  children,
}: {
  label: string;
  title: string;
  align?: "start" | "end";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <th className={className}>
      <Popover>
        <PopoverTrigger
          // Inherits the heading's type; only the dotted rule marks it as pressable.
          className="[font:inherit] tracking-[inherit] text-inherit uppercase underline decoration-dotted underline-offset-4 hover:text-foreground"
        >
          {label}
        </PopoverTrigger>
        <PopoverContent title={title} align={align}>
          <div className="text-ink-2">{children}</div>
        </PopoverContent>
      </Popover>
    </th>
  );
}

/** The standings GB heading, defined the way dbt computes it. */
export function GamesBackHeader() {
  return (
    <ColumnHelp label="GB" title="Games back" className="text-right">
      <p>
        How far a team trails the conference leader: half the gap in wins plus half the gap in
        losses. A dash means tied for first.
      </p>
    </ColumnHelp>
  );
}
