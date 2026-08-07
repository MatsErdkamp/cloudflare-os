"use client";

import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Checkbox } from "#/components/ui/checkbox";
import { useProximityHover } from "#/hooks/use-proximity-hover";
import { fontWeights } from "#/lib/font-weight";
import { roundedShape } from "#/lib/shape-tokens";
import { spring } from "#/lib/springs";
import { cn } from "#/lib/utils";

interface CheckboxGroupContextValue {
  activeIndex: number | null;
  registerItem: (index: number, element: HTMLElement | null) => void;
}

const CheckboxGroupContext = createContext<CheckboxGroupContextValue | null>(null);

interface CheckboxGroupProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  checkedIndices: ReadonlySet<number>;
}

const CheckboxGroup = forwardRef<HTMLDivElement, CheckboxGroupProps>(
  ({ children, checkedIndices, className, ...props }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const { activeIndex, handlers, itemRects, registerItem, measureItems, sessionRef } =
      useProximityHover(containerRef);
    useEffect(() => measureItems(), [children, measureItems]);
    const activeRect = activeIndex === null ? null : itemRects[activeIndex];
    const checkedRects = [...checkedIndices]
      .sort((a, b) => a - b)
      .reduce<Array<{ end: number; start: number }>>((runs, index) => {
        const previous = runs.at(-1);
        if (previous && index === previous.end + 1) previous.end = index;
        else runs.push({ start: index, end: index });
        return runs;
      }, [])
      .flatMap(({ start, end }) => {
        const first = itemRects[start];
        const last = itemRects[end];
        if (!first || !last) return [];
        return [
          {
            key: `${start}-${end}`,
            left: first.left,
            top: first.top,
            width: Math.max(first.width, last.width),
            height: last.top + last.height - first.top,
          },
        ];
      });
    const context = useMemo(() => ({ activeIndex, registerItem }), [activeIndex, registerItem]);

    return (
      <CheckboxGroupContext.Provider value={context}>
        <div
          ref={(node) => {
            containerRef.current = node;
            if (typeof ref === "function") ref(node);
            else if (ref) ref.current = node;
          }}
          role="group"
          className={cn("relative flex w-72 max-w-full flex-col select-none", className)}
          onMouseEnter={handlers.onMouseEnter}
          onMouseMove={handlers.onMouseMove}
          onMouseLeave={handlers.onMouseLeave}
          {...props}
        >
          {checkedRects.map(({ key, ...rect }) => (
            <motion.div
              data-slot="checkbox-selection"
              key={key}
              className={cn("pointer-events-none absolute bg-active", roundedShape.bg)}
              layout
              animate={rect}
              transition={spring.fast}
            />
          ))}
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
        </div>
      </CheckboxGroupContext.Provider>
    );
  },
);

CheckboxGroup.displayName = "CheckboxGroup";

interface CheckboxItemProps extends HTMLAttributes<HTMLLabelElement> {
  checked: boolean;
  index: number;
  label: ReactNode;
  onToggle: () => void;
}

const CheckboxItem = forwardRef<HTMLLabelElement, CheckboxItemProps>(
  ({ checked, className, index, label, onToggle, ...props }, ref) => {
    const context = useContext(CheckboxGroupContext);
    if (!context) throw new Error("CheckboxItem must be used within CheckboxGroup");
    const itemRef = useRef<HTMLLabelElement | null>(null);
    useEffect(() => {
      context.registerItem(index, itemRef.current);
      return () => context.registerItem(index, null);
    }, [context, index]);

    return (
      <label
        ref={(node) => {
          itemRef.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        className={cn(
          "relative z-10 flex h-8 cursor-pointer items-center gap-2.5 px-3 text-[13px] outline-none",
          roundedShape.item,
          className,
        )}
        {...props}
      >
        <Checkbox checked={checked} onCheckedChange={onToggle} />
        <span
          className={cn(
            "[text-box:trim-both_cap_alphabetic] transition-colors",
            checked || context.activeIndex === index ? "text-foreground" : "text-muted-foreground",
          )}
          style={{ fontVariationSettings: checked ? fontWeights.semibold : fontWeights.normal }}
        >
          {label}
        </span>
      </label>
    );
  },
);

CheckboxItem.displayName = "CheckboxItem";

export { CheckboxGroup, CheckboxItem };
export type { CheckboxGroupProps, CheckboxItemProps };
