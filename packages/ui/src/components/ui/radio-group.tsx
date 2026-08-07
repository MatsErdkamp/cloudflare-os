"use client";

import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import { AnimatePresence, motion } from "framer-motion";
import { useProximityHover } from "#/hooks/use-proximity-hover";
import { fontWeights } from "#/lib/font-weight";
import { roundedShape } from "#/lib/shape-tokens";
import { spring } from "#/lib/springs";
import { cn } from "#/lib/utils";

interface RadioMotionContextValue {
  activeIndex: number | null;
  registerItem: (index: number, element: HTMLElement | null) => void;
}

const RadioMotionContext = createContext<RadioMotionContextValue | null>(null);

type RadioGroupProps = ComponentPropsWithoutRef<typeof RadioGroupPrimitive> & {
  children: ReactNode;
};

const RadioGroup = forwardRef<HTMLDivElement, RadioGroupProps>(
  ({ children, className, ...props }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const { activeIndex, handlers, itemRects, registerItem, measureItems, sessionRef } =
      useProximityHover(containerRef);

    useEffect(() => measureItems(), [children, measureItems]);

    const activeRect = activeIndex === null ? null : itemRects[activeIndex];
    const context = useMemo(() => ({ activeIndex, registerItem }), [activeIndex, registerItem]);

    return (
      <RadioMotionContext.Provider value={context}>
        <RadioGroupPrimitive
          ref={(node) => {
            containerRef.current = node;
            if (typeof ref === "function") ref(node);
            else if (ref) ref.current = node;
          }}
          className={cn("relative flex w-72 max-w-full flex-col select-none", className)}
          onMouseEnter={handlers.onMouseEnter}
          onMouseMove={handlers.onMouseMove}
          onMouseLeave={handlers.onMouseLeave}
          {...props}
        >
          <AnimatePresence>
            {activeRect && (
              <motion.div
                key={sessionRef.current}
                className={cn("pointer-events-none absolute bg-hover", roundedShape.bg)}
                initial={{ opacity: 0, ...activeRect }}
                animate={{ opacity: 1, ...activeRect }}
                exit={{ opacity: 0, transition: spring.fast.exit }}
                transition={spring.fast}
              />
            )}
          </AnimatePresence>
          {children}
        </RadioGroupPrimitive>
      </RadioMotionContext.Provider>
    );
  },
);

RadioGroup.displayName = "RadioGroup";

interface RadioGroupItemProps extends Omit<RadioPrimitive.Root.Props, "children"> {
  index: number;
  label: ReactNode;
}

const RadioGroupItem = forwardRef<HTMLElement, RadioGroupItemProps>(
  ({ className, index, label, ...props }, ref) => {
    const context = useContext(RadioMotionContext);
    if (!context) throw new Error("RadioGroupItem must be used within RadioGroup");
    const itemRef = useRef<HTMLElement | null>(null);

    useEffect(() => {
      context.registerItem(index, itemRef.current);
      return () => context.registerItem(index, null);
    }, [context, index]);

    const active = context.activeIndex === index;
    return (
      <RadioPrimitive.Root
        ref={(node) => {
          itemRef.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        className={cn(
          "group relative z-10 flex h-8 cursor-pointer items-center gap-2.5 px-3 text-[13px] text-muted-foreground outline-none transition-colors data-checked:bg-active data-checked:text-foreground focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)] disabled:pointer-events-none disabled:opacity-50",
          roundedShape.item,
          className,
        )}
        {...props}
      >
        <span className="relative size-[15px] shrink-0 rounded-full border-[1.5px] border-border transition-colors group-data-checked:border-transparent group-hover:border-foreground/40">
          <RadioPrimitive.Indicator className="absolute inset-0 flex items-center justify-center">
            <motion.span
              className="size-2 rounded-full bg-foreground"
              initial={{ opacity: 0, scale: 0.3 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={spring.fast}
            />
          </RadioPrimitive.Indicator>
        </span>
        <span
          className="[text-box:trim-both_cap_alphabetic]"
          style={{ fontVariationSettings: active ? fontWeights.semibold : fontWeights.normal }}
        >
          {label}
        </span>
      </RadioPrimitive.Root>
    );
  },
);

RadioGroupItem.displayName = "RadioGroupItem";

export { RadioGroup, RadioGroupItem };
export type { RadioGroupItemProps, RadioGroupProps };
