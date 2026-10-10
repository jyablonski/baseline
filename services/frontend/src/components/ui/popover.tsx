"use client";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";

import { cn } from "@/lib/utils";

function Popover(props: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger(props: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
  className,
  title,
  aside,
  children,
  side = "bottom",
  align = "start",
  sideOffset = 6,
  anchor,
  ...props
}: Omit<PopoverPrimitive.Popup.Props, "title"> &
  Pick<PopoverPrimitive.Positioner.Props, "side" | "align" | "sideOffset" | "anchor"> & {
    title: string;
    /** Sits opposite the title, before the close button, e.g. a price. */
    aside?: React.ReactNode;
  }) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        anchor={anchor}
        collisionPadding={12}
        className="z-40"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            "w-[min(400px,calc(100vw-24px))] border border-rule-strong bg-raised p-[var(--ct-space-3)] text-sm font-normal tracking-normal text-foreground normal-case shadow-[0_8px_24px_rgb(0_0_0/0.12)] outline-none",
            className
          )}
          {...props}
        >
          <div className="mb-2 flex items-start justify-between gap-3">
            <PopoverPrimitive.Title className="font-semibold">{title}</PopoverPrimitive.Title>
            <div className="flex items-start gap-2">
              {aside}
              <PopoverPrimitive.Close
                aria-label="Close"
                className="-mt-0.5 px-1 text-base leading-none text-ink-3 hover:text-foreground"
              >
                ×
              </PopoverPrimitive.Close>
            </div>
          </div>
          {children}
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverTrigger, PopoverContent };
