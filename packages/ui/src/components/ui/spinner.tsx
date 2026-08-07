"use client";

import { type IconComponentProps, useIcon } from "#/lib/icon-context";
import { cn } from "#/lib/utils";

function Spinner({ className, ...props }: IconComponentProps) {
  const LoaderIcon = useIcon("loader");
  return (
    <LoaderIcon
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  );
}

export { Spinner };
