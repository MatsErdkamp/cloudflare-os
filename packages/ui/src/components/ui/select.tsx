"use client";

import { Select as SelectPrimitive } from "@base-ui/react/select";
import type { ReactNode } from "react";
import { Icons } from "#/lib/icons";
import { cn } from "#/lib/utils";
import type { PortalContainer } from "#/lib/portal";

type SelectProps<Value, Multiple extends boolean | undefined = false> = Omit<
  SelectPrimitive.Root.Props<Value, Multiple>,
  "items"
> & {
  readonly items?:
    | ReadonlyArray<{ readonly label: ReactNode; readonly value: Value }>
    | Record<string, ReactNode>;
};

/** Controls an accessible styled select and its typed selection value. */
function Select<Value, Multiple extends boolean | undefined = false>(
  props: SelectProps<Value, Multiple>,
) {
  return <SelectPrimitive.Root {...props} />;
}

/** Renders the styled button that opens a Select. */
function SelectTrigger({ className, children, ...props }: SelectPrimitive.Trigger.Props) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "flex h-10 w-full items-center gap-2 rounded-3xl border border-transparent bg-input/50 px-3 text-left text-sm outline-none transition-colors hover:bg-input/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 data-popup-open:border-ring data-popup-open:ring-3 data-popup-open:ring-ring/20 disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <SelectPrimitive.Icon className="shrink-0 text-muted-foreground">
        <Icons.ChevronDown size={14} />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

/** Renders the selected item label or a placeholder. */
function SelectValue(props: SelectPrimitive.Value.Props) {
  return <SelectPrimitive.Value {...props} />;
}

/** Renders a portalled, height-constrained Select popup. */
function SelectContent({
  align = "start",
  alignItemWithTrigger = false,
  className,
  children,
  container,
  sideOffset = 6,
  ...props
}: SelectPrimitive.Popup.Props &
  Pick<SelectPrimitive.Positioner.Props, "align" | "alignItemWithTrigger" | "sideOffset"> & {
    container?: PortalContainer;
  }) {
  return (
    <SelectPrimitive.Portal container={container}>
      <SelectPrimitive.Positioner
        align={align}
        alignItemWithTrigger={alignItemWithTrigger}
        className="isolate z-60 outline-none"
        sideOffset={sideOffset}
      >
        <SelectPrimitive.Popup
          className={cn(
            "dark max-h-(--available-height) w-(--anchor-width) min-w-64 origin-(--transform-origin) overflow-hidden rounded-3xl bg-popover/80 p-1.5 text-popover-foreground shadow-xl ring-1 ring-foreground/10 backdrop-blur-2xl backdrop-saturate-150 outline-none duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className,
          )}
          {...props}
        >
          <SelectPrimitive.List className="max-h-72 overflow-y-auto outline-none">
            {children}
          </SelectPrimitive.List>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

type SelectItemProps<Value> = Omit<SelectPrimitive.Item.Props, "value"> & {
  readonly value: Value;
};

/** Renders one typed option inside a Select popup. */
function SelectItem<Value>({ className, children, ...props }: SelectItemProps<Value>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "relative flex cursor-default items-center gap-2.5 rounded-2xl py-2.5 pr-9 pl-3 text-sm font-medium outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-foreground/10",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className="min-w-0 flex-1 truncate">
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-3 flex items-center text-primary">
        <Icons.Success size={14} />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };
