"use client";

import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion";
import { Icons } from "#/lib/icons";
import { roundedShape } from "#/lib/shape-tokens";
import { cn } from "#/lib/utils";

function Accordion<Value>(props: AccordionPrimitive.Root.Props<Value>) {
  return <AccordionPrimitive.Root {...props} />;
}

function AccordionItem({ className, ...props }: AccordionPrimitive.Item.Props) {
  return (
    <AccordionPrimitive.Item
      className={cn("group overflow-hidden border-b border-border last:border-b-0", className)}
      {...props}
    />
  );
}

function AccordionTrigger({ className, children, ...props }: AccordionPrimitive.Trigger.Props) {
  return (
    <AccordionPrimitive.Header>
      <AccordionPrimitive.Trigger
        className={cn(
          "flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm font-medium text-foreground outline-none transition-colors hover:bg-hover focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)]",
          roundedShape.item,
          className,
        )}
        {...props}
      >
        {children}
        <Icons.ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform duration-160 group-data-open:rotate-180" />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

function AccordionContent({ className, children, ...props }: AccordionPrimitive.Panel.Props) {
  return (
    <AccordionPrimitive.Panel
      className={cn(
        "h-[var(--accordion-panel-height)] overflow-hidden text-sm text-muted-foreground transition-[height] duration-160 ease-out data-ending-style:h-0 data-starting-style:h-0",
        className,
      )}
      {...props}
    >
      <div className="px-3 pb-3">{children}</div>
    </AccordionPrimitive.Panel>
  );
}

export { Accordion, AccordionContent, AccordionItem, AccordionTrigger };
