"use client";

import {
  Children,
  createContext,
  forwardRef,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
} from "react";
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { AnimatePresence, motion } from "framer-motion";
import { useProximityHover } from "#/hooks/use-proximity-hover";
import { fontWeights } from "#/lib/font-weight";
import type { IconComponent } from "#/lib/icon-context";
import { setRef } from "#/lib/set-ref";
import { spring } from "#/lib/springs";
import { surfaceClasses } from "#/lib/surface-classes";
import { useSurface } from "#/lib/surface-context";
import { cn } from "#/lib/utils";

interface TabsRootContextValue {
  readonly selectedValue: string | undefined;
  readonly setValueOrder: (values: ReadonlyArray<string>) => void;
}

const TabsRootContext = createContext<TabsRootContextValue | null>(null);

interface TabsListContextValue {
  readonly hoveredIndex: number | null;
  readonly registerTab: (index: number, element: HTMLElement | null) => void;
  readonly selectedValue: string | undefined;
  readonly setOptimisticIndex: (index: number) => void;
  readonly valueOrder: ReadonlyArray<string>;
  readonly variant: "segmented" | "underline";
}

const TabsListContext = createContext<TabsListContextValue | null>(null);

function useTabsList(): TabsListContextValue {
  const context = useContext(TabsListContext);
  if (!context) {
    throw new Error("TabItem must be used within TabsList");
  }
  return context;
}

/** Props for the controlled or uncontrolled Fluid Tabs root. */
interface TabsProps extends Omit<
  ComponentPropsWithoutRef<typeof TabsPrimitive.Root>,
  "defaultValue" | "onValueChange" | "value"
> {
  readonly defaultValue?: string;
  readonly onValueChange?: (value: string) => void;
  readonly value?: string;
}

/** Fluid segmented tabs backed by the accessible Base UI primitive. */
const Tabs = forwardRef<HTMLDivElement, TabsProps>(
  ({ defaultValue, onValueChange, value, children, ...props }, ref) => {
    const [valueOrder, setValueOrder] = useState<ReadonlyArray<string>>([]);
    const [uncontrolledValue, setUncontrolledValue] = useState<string | undefined>(defaultValue);
    const selectedValue = value ?? uncontrolledValue ?? valueOrder[0];

    const updateValueOrder = useCallback((nextValues: ReadonlyArray<string>) => {
      setValueOrder((currentValues) => {
        const unchanged =
          currentValues.length === nextValues.length &&
          currentValues.every((currentValue, index) => currentValue === nextValues[index]);
        return unchanged ? currentValues : nextValues;
      });
    }, []);

    const handleValueChange = useCallback(
      (nextValue: unknown) => {
        if (typeof nextValue !== "string") return;
        if (value === undefined) setUncontrolledValue(nextValue);
        onValueChange?.(nextValue);
      },
      [onValueChange, value],
    );

    return (
      <TabsRootContext.Provider value={{ selectedValue, setValueOrder: updateValueOrder }}>
        <TabsPrimitive.Root
          ref={ref}
          onValueChange={handleValueChange}
          value={selectedValue ?? ""}
          {...props}
        >
          {children}
        </TabsPrimitive.Root>
      </TabsRootContext.Provider>
    );
  },
);

Tabs.displayName = "Tabs";

/** Props passed through to the Base UI tab-list primitive. */
type TabsListProps = ComponentPropsWithoutRef<typeof TabsPrimitive.List> & {
  readonly variant?: "segmented" | "underline";
};

/** Fluid tab list with spring-selected and proximity-hover surfaces. */
const TabsList = forwardRef<HTMLDivElement, TabsListProps>(
  ({ children, className, variant = "segmented", ...props }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const mouseInsideRef = useRef(false);
    const rootContext = useContext(TabsRootContext);
    const substrate = useSurface();
    const values = Children.toArray(children)
      .filter((child) => isValidElement<{ readonly value?: unknown }>(child))
      .flatMap((child) => {
        const childValue = child.props.value;
        return typeof childValue === "string" ? [childValue] : [];
      });
    const valueOrderKey = values.join("\u0000");
    const [optimisticIndex, setOptimisticIndex] = useState<number | null>(null);
    const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
    const {
      activeIndex: hoveredIndex,
      handlers,
      itemRects,
      measureItems,
      registerItem,
      setActiveIndex: setHoveredIndex,
    } = useProximityHover(containerRef, { axis: "x" });

    useLayoutEffect(() => {
      rootContext?.setValueOrder(values);
    }, [rootContext, valueOrderKey]);

    useEffect(() => {
      measureItems();
    }, [children, measureItems]);

    const selectedIndex = rootContext?.selectedValue
      ? values.indexOf(rootContext.selectedValue)
      : -1;

    useEffect(() => {
      setOptimisticIndex(selectedIndex >= 0 ? selectedIndex : null);
    }, [selectedIndex]);

    const activeSelectedIndex = optimisticIndex ?? (selectedIndex >= 0 ? selectedIndex : null);
    const selectedRect = activeSelectedIndex === null ? null : itemRects[activeSelectedIndex];
    const hoverRect = hoveredIndex === null ? null : itemRects[hoveredIndex];
    const focusRect = focusedIndex === null ? null : itemRects[focusedIndex];
    const hoveringAnotherTab = hoveredIndex !== null && hoveredIndex !== activeSelectedIndex;

    return (
      <TabsListContext.Provider
        value={{
          hoveredIndex,
          registerTab: registerItem,
          selectedValue: rootContext?.selectedValue,
          setOptimisticIndex,
          variant,
          valueOrder: values,
        }}
      >
        <TabsPrimitive.List
          activateOnFocus
          ref={(node) => {
            containerRef.current = node;
            setRef(ref, node);
          }}
          className={cn(
            "relative inline-flex items-center gap-0.5 select-none",
            variant === "segmented"
              ? "rounded-full bg-muted p-1"
              : "border-b border-border bg-transparent px-0",
            className,
          )}
          onBlur={(event) => {
            if (containerRef.current?.contains(event.relatedTarget)) return;
            setFocusedIndex(null);
            if (!mouseInsideRef.current) setHoveredIndex(null);
          }}
          onFocus={(event) => {
            const trigger = event.target.closest<HTMLElement>('[role="tab"]');
            const index = trigger?.dataset.proximityIndex;
            if (index === undefined) return;
            const parsedIndex = Number(index);
            setHoveredIndex(parsedIndex);
            setFocusedIndex(event.target.matches(":focus-visible") ? parsedIndex : null);
          }}
          onMouseEnter={() => {
            mouseInsideRef.current = true;
            handlers.onMouseEnter();
          }}
          onMouseLeave={() => {
            mouseInsideRef.current = false;
            handlers.onMouseLeave();
          }}
          onMouseMove={handlers.onMouseMove}
          {...props}
        >
          {selectedRect && (
            <motion.div
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute",
                variant === "segmented"
                  ? cn(surfaceClasses(Math.min(substrate + 3, 8)), "rounded-full")
                  : "rounded-full bg-foreground",
              )}
              initial={false}
              animate={{
                height: variant === "segmented" ? selectedRect.height : 2,
                left: selectedRect.left,
                opacity: hoveringAnotherTab ? 0.85 : 1,
                top:
                  variant === "segmented"
                    ? selectedRect.top
                    : selectedRect.top + selectedRect.height - 2,
                width: selectedRect.width,
              }}
              transition={{ ...spring.moderate, opacity: { duration: 0.08 } }}
            />
          )}

          <AnimatePresence>
            {hoverRect && hoveringAnotherTab && (
              <motion.div
                aria-hidden="true"
                className="pointer-events-none absolute rounded-full bg-hover"
                initial={{ opacity: 0 }}
                animate={{
                  height: hoverRect.height,
                  left: hoverRect.left,
                  opacity: 0.4,
                  top: hoverRect.top,
                  width: hoverRect.width,
                }}
                exit={{ opacity: 0, transition: spring.fast.exit }}
                transition={{ ...spring.fast, opacity: { duration: 0.08 } }}
              />
            )}
          </AnimatePresence>

          <AnimatePresence>
            {focusRect && (
              <motion.div
                aria-hidden="true"
                className={cn(
                  "pointer-events-none absolute z-20 border border-[color:var(--focus-ring)]",
                  "rounded-full",
                )}
                initial={false}
                animate={{
                  height: focusRect.height + 4,
                  left: focusRect.left - 2,
                  top: focusRect.top - 2,
                  width: focusRect.width + 4,
                }}
                exit={{ opacity: 0, transition: spring.fast.exit }}
                transition={spring.fast}
              />
            )}
          </AnimatePresence>

          {children}
        </TabsPrimitive.List>
      </TabsListContext.Provider>
    );
  },
);

TabsList.displayName = "TabsList";

/** Props for one labelled Fluid tab trigger. */
interface TabItemProps extends ComponentPropsWithoutRef<typeof TabsPrimitive.Tab> {
  readonly icon?: IconComponent;
  readonly label: string;
  readonly value: string;
}

/** One labelled Fluid tab trigger. */
const TabItem = forwardRef<HTMLButtonElement, TabItemProps>(
  ({ className, icon: Icon, label, onClick, value, ...props }, ref) => {
    const internalRef = useRef<HTMLButtonElement>(null);
    const { hoveredIndex, registerTab, selectedValue, setOptimisticIndex, valueOrder, variant } =
      useTabsList();
    const index = valueOrder.indexOf(value);
    const selected = selectedValue === value;
    const active = selected || hoveredIndex === index;

    useEffect(() => {
      if (index < 0) return;
      registerTab(index, internalRef.current);
      return () => registerTab(index, null);
    }, [index, registerTab]);

    return (
      <TabsPrimitive.Tab
        ref={(node) => {
          if (node !== null && !(node instanceof HTMLButtonElement)) {
            throw new TypeError("Fluid TabItem must render a button element");
          }
          internalRef.current = node;
          setRef(ref, node);
        }}
        className={cn(
          "relative z-10 flex cursor-pointer items-center gap-2 border-none bg-transparent px-3 outline-none",
          variant === "segmented" ? "h-8" : "h-9",
          className,
        )}
        data-proximity-index={index}
        onClick={(event) => {
          if (index >= 0) setOptimisticIndex(index);
          onClick?.(event);
        }}
        value={value}
        {...props}
      >
        {Icon && (
          <Icon
            className={cn(
              "transition-[color,stroke-width] duration-80",
              active ? "text-foreground" : "text-muted-foreground",
            )}
            size={16}
            strokeWidth={active ? 2 : 1.5}
          />
        )}
        <span className="inline-grid whitespace-nowrap text-[13px]">
          <span
            aria-hidden="true"
            className="invisible col-start-1 row-start-1 [text-box:trim-both_cap_alphabetic]"
            style={{ fontVariationSettings: fontWeights.semibold }}
          >
            {label}
          </span>
          <span
            className={cn(
              "col-start-1 row-start-1 transition-[color,font-variation-settings] duration-80 [text-box:trim-both_cap_alphabetic]",
              active ? "text-foreground" : "text-muted-foreground",
            )}
            style={{ fontVariationSettings: selected ? fontWeights.semibold : fontWeights.normal }}
          >
            {label}
          </span>
        </span>
      </TabsPrimitive.Tab>
    );
  },
);

TabItem.displayName = "TabItem";

/** Props passed through to one accessible Base UI tab panel. */
type TabPanelProps = ComponentPropsWithoutRef<typeof TabsPrimitive.Panel>;

/** Accessible Fluid tab panel. */
const TabPanel = forwardRef<HTMLDivElement, TabPanelProps>(({ className, ...props }, ref) => (
  <TabsPrimitive.Panel ref={ref} className={cn("outline-none", className)} {...props} />
));

TabPanel.displayName = "TabPanel";

export { TabItem, TabPanel, Tabs, TabsList };
export type { TabItemProps, TabPanelProps, TabsListProps, TabsProps };
