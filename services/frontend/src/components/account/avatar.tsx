"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

/** The visitor's provider picture, or their initial when there is none. */
export function Avatar({
  name,
  image,
  className,
}: {
  name: string;
  image: string | null;
  /** Size, text size and any offset: the circle itself is drawn here. */
  className?: string;
}) {
  // The picture is hosted by the provider and can go away; fall back to the initial.
  const [failedImage, setFailedImage] = useState<string | null>(null);

  if (image && image !== failedImage) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={image}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailedImage(image)}
        className={cn("shrink-0 rounded-full border border-rule object-cover", className)}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground",
        className
      )}
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}
