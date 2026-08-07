"use client";

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { motion } from "framer-motion";
import { cva, type VariantProps } from "class-variance-authority";
import { spring } from "#/lib/springs";
import { cn } from "#/lib/utils";

const switchVariants = cva(
  "group relative inline-flex shrink-0 cursor-pointer items-center rounded-full bg-accent outline-none transition-colors duration-80 hover:bg-accent/80 focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)] disabled:pointer-events-none disabled:opacity-50 data-checked:bg-[color:var(--focus-ring)]",
  {
    variants: {
      size: {
        sm: "h-4 w-7",
        md: "h-5 w-[34px]",
        lg: "h-6 w-10",
      },
    },
    defaultVariants: { size: "md" },
  },
);

const thumbSizes = {
  sm: "size-3 translate-x-0.5 group-data-checked:translate-x-3.5",
  md: "size-4 translate-x-0.5 group-data-checked:translate-x-4",
  lg: "size-5 translate-x-0.5 group-data-checked:translate-x-[18px]",
} as const;

type SwitchProps = SwitchPrimitive.Root.Props & VariantProps<typeof switchVariants>;

function Switch({ className, size = "md", ...props }: SwitchProps) {
  const resolvedSize = size ?? "md";
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(switchVariants({ size: resolvedSize }), className)}
      {...props}
    >
      <SwitchPrimitive.Thumb
        render={
          <motion.span
            layout
            className={cn(
              "block rounded-full bg-white shadow-sm transition-transform duration-150",
              thumbSizes[resolvedSize],
            )}
            transition={spring.moderate}
          />
        }
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
export type { SwitchProps };
