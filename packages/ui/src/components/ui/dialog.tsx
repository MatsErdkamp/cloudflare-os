"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Button } from "#/components/ui/button";
import { Scrim } from "#/components/ui/scrim";
import { Icons } from "#/lib/icons";
import { cn } from "#/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

interface DialogContentProps extends DialogPrimitive.Popup.Props {
  container?: DialogPrimitive.Portal.Props["container"];
  size?: "sm" | "md" | "lg" | "xl";
}

const dialogSizes = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-3xl",
} as const;

export function DialogContent({
  className,
  children,
  container,
  size = "md",
  ...props
}: DialogContentProps) {
  return (
    <DialogPrimitive.Portal container={container}>
      <Scrim />
      <DialogPrimitive.Popup
        className={cn(
          "fixed top-1/2 left-1/2 z-50 max-h-[90svh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border bg-popover p-6 text-popover-foreground shadow-2xl outline-none transition data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0",
          dialogSizes[size],
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          aria-label="Close"
          className="absolute top-4 right-4"
          render={<Button size="icon-sm" variant="ghost" />}
        >
          <Icons.X />
        </DialogPrimitive.Close>
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader(props: React.ComponentProps<"div">) {
  return <div className="flex flex-col gap-1.5 pr-8" {...props} />;
}

export function DialogTitle(props: DialogPrimitive.Title.Props) {
  return <DialogPrimitive.Title className="text-lg font-medium tracking-tight" {...props} />;
}

export function DialogDescription(props: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description className="text-sm leading-6 text-muted-foreground" {...props} />
  );
}
