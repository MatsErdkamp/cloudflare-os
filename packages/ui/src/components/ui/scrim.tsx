"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { motion, useReducedMotionConfig, type HTMLMotionProps } from "framer-motion";
import { spring } from "#/lib/springs";
import { cn } from "#/lib/utils";

type ScrimProps = Omit<DialogPrimitive.Backdrop.Props, "className" | "render"> & {
  readonly className?: string;
};

/**
 * Shared modal backdrop for dialogs, drawers, and other blocking surfaces.
 * Its animation follows the Fluid moderate motion tier and respects reduced motion.
 */
export function Scrim({ className, ...props }: ScrimProps) {
  const prefersReducedMotion = useReducedMotionConfig();

  return (
    <DialogPrimitive.Backdrop
      data-slot="scrim"
      className={cn("fixed inset-0 z-50", className)}
      render={(backdropProps, state) => {
        // SAFETY: Base UI supplies native div props here. Framer Motion accepts
        // that same DOM surface but widens some event handler signatures.
        const motionProps = backdropProps as HTMLMotionProps<"div">;

        return (
          <motion.div
            {...motionProps}
            animate={{
              backdropFilter: state.open ? "blur(2px)" : "blur(0px)",
              opacity: state.open ? 1 : 0,
            }}
            initial={prefersReducedMotion ? false : { backdropFilter: "blur(0px)", opacity: 0 }}
            transition={
              prefersReducedMotion
                ? { duration: 0 }
                : state.open
                  ? spring.moderate
                  : spring.moderate.exit
            }
          />
        );
      }}
      style={{ backgroundColor: "rgb(0 0 0 / 45%)" }}
      {...props}
    />
  );
}
