"use client";

import { Info } from "lucide-react";

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

/**
 * A small ⓘ that explains a term: opens on hover for a mouse, on press for
 * touch and keyboard, since a hover-only tip is unreachable on a phone.
 */
export function InfoTip({
  label,
  title,
  align,
  children,
}: {
  /** What the button is about, for screen readers: "About MVP score". */
  label: string;
  title: string;
  align?: "start" | "end";
  children: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        aria-label={label}
        // A quiet glyph with a full-size hit area: the negative margin keeps the
        // 28px target from pushing the heading's line taller than the text.
        className="-m-1.5 inline-flex size-7 items-center justify-center rounded-full text-ink-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary data-[popup-open]:text-foreground"
      >
        {/* Sized to the module heading it sits beside and stroked to match a
            semibold face, so it reads as part of the title, not a stray mark. */}
        <Info
          aria-hidden="true"
          className="size-[var(--ct-fs-module)] -translate-y-px"
          strokeWidth={2.25}
        />
      </PopoverTrigger>
      <PopoverContent title={title} align={align}>
        <div className="space-y-2 text-ink-2">{children}</div>
      </PopoverContent>
    </Popover>
  );
}
