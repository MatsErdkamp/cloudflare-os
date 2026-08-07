"use client";

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { AnimatePresence, motion } from "framer-motion";
import { Icons } from "#/lib/icons";
import { cn } from "#/lib/utils";

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "group relative inline-flex size-[15px] shrink-0 cursor-pointer items-center justify-center rounded-[5px] border-[1.5px] border-border bg-transparent text-foreground outline-none transition-colors duration-80 hover:border-foreground/40 focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)] disabled:pointer-events-none disabled:opacity-50 data-checked:border-transparent data-checked:bg-active data-indeterminate:border-transparent data-indeterminate:bg-active",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        keepMounted
        className="flex items-center justify-center data-unchecked:hidden"
      >
        <AnimatePresence initial={false}>
          <motion.span
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ duration: 0.08 }}
          >
            <Icons.Success className="size-3" aria-hidden="true" />
          </motion.span>
        </AnimatePresence>
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
