"use client";

import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
import { Icons } from "#/lib/icons";
import { cn } from "#/lib/utils";

const Collapsible = CollapsiblePrimitive.Root;
const CollapsibleTrigger = CollapsiblePrimitive.Trigger;
const CollapsiblePanel = CollapsiblePrimitive.Panel;

function CollapsibleDefaultTrigger({ className, children, ...props }: CollapsiblePrimitive.Trigger.Props) {
  return (
    <CollapsibleTrigger
      className={cn("group flex w-full items-center justify-between rounded-2xl px-3 py-2 text-sm font-medium hover:bg-hover", className)}
      {...props}
    >
      {children}
      <Icons.ChevronRight className="transition-transform group-data-panel-open:rotate-90" size={14} />
    </CollapsibleTrigger>
  );
}

function CollapsibleDefaultPanel({ className, ...props }: CollapsiblePrimitive.Panel.Props) {
  return <CollapsiblePanel className={cn("ml-3 border-l border-border py-2 pl-4 text-sm text-muted-foreground", className)} {...props} />;
}

export { Collapsible, CollapsibleDefaultPanel, CollapsibleDefaultTrigger, CollapsiblePanel, CollapsibleTrigger };
