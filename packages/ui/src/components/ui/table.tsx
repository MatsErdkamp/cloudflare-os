"use client";

import {
  useRef,
  useEffect,
  useMemo,
  createContext,
  useContext,
  forwardRef,
  type ComponentProps,
  type ReactNode,
  type HTMLAttributes,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { setRef } from "#/lib/set-ref";
import { cn } from "#/lib/utils";
import { spring } from "#/lib/springs";
import { fontWeights } from "#/lib/font-weight";
import { useProximityHover } from "#/hooks/use-proximity-hover";
import { Checkbox } from "#/components/ui/checkbox";

// ── Context ──────────────────────────────────────────────

interface TableContextValue {
  registerItem: (index: number, element: HTMLElement | null) => void;
  activeIndex: number | null;
}

const TableContext = createContext<TableContextValue | null>(null);

// ── Table ────────────────────────────────────────────────

interface TableProps extends HTMLAttributes<HTMLTableElement> {
  children: ReactNode;
  layout?: "auto" | "fixed";
}

/** Renders a horizontally accessible Fluid table with proximity row feedback. */
const Table = forwardRef<HTMLTableElement, TableProps>(
  ({ children, className, layout = "auto", style, ...props }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);

    const { activeIndex, itemRects, sessionRef, handlers, registerItem, measureItems } =
      useProximityHover(containerRef);

    useEffect(() => {
      measureItems();
    }, [measureItems, children]);

    const activeRect = activeIndex !== null ? itemRects[activeIndex] : null;

    const contextValue = useMemo(
      () => ({ registerItem, activeIndex }),
      [registerItem, activeIndex],
    );

    return (
      <TableContext.Provider value={contextValue}>
        <div
          ref={containerRef}
          aria-label="Scrollable table"
          className="relative overflow-x-auto"
          role="region"
          tabIndex={0}
          onMouseEnter={handlers.onMouseEnter}
          onMouseMove={handlers.onMouseMove}
          onMouseLeave={handlers.onMouseLeave}
        >
          {/* Hover background */}
          <AnimatePresence>
            {activeRect && (
              <motion.div
                key={sessionRef.current}
                className="absolute bg-hover pointer-events-none"
                initial={{
                  opacity: 0,
                  top: activeRect.top,
                  left: activeRect.left,
                  width: activeRect.width,
                  height: activeRect.height,
                }}
                animate={{
                  opacity: 1,
                  top: activeRect.top,
                  left: activeRect.left,
                  width: activeRect.width,
                  height: activeRect.height,
                }}
                exit={{ opacity: 0, transition: spring.fast.exit }}
                transition={{
                  ...spring.fast,
                  opacity: { duration: 0.08 },
                }}
              />
            )}
          </AnimatePresence>

          <table
            ref={ref}
            className={cn("w-full text-[13px] border-collapse", className)}
            style={{ tableLayout: layout, ...style }}
            {...props}
          >
            {children}
          </table>
        </div>
      </TableContext.Provider>
    );
  },
);

Table.displayName = "Table";

// ── TableHeader ──────────────────────────────────────────

/** Renders the table header row group. */
const TableHeader = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => <thead ref={ref} className={cn("", className)} {...props} />,
);

TableHeader.displayName = "TableHeader";

// ── TableBody ────────────────────────────────────────────

/** Renders the table body row group. */
const TableBody = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => <tbody ref={ref} className={cn("", className)} {...props} />,
);

TableBody.displayName = "TableBody";

// ── TableRow ─────────────────────────────────────────────

interface TableRowProps extends HTMLAttributes<HTMLTableRowElement> {
  index?: number;
  variant?: "default" | "selected";
}

/** Renders a table row that can participate in proximity hover feedback. */
const TableRow = forwardRef<HTMLTableRowElement, TableRowProps>(
  ({ index, className, style, variant = "default", ...props }, ref) => {
    const internalRef = useRef<HTMLTableRowElement>(null);
    const ctx = useContext(TableContext);

    useEffect(() => {
      if (index === undefined || !ctx) return;
      ctx.registerItem(index, internalRef.current);
      return () => ctx.registerItem(index, null);
    }, [index, ctx]);

    const isBodyRow = index !== undefined;
    const activeIdx = ctx?.activeIndex ?? null;
    const hideBorder =
      activeIdx !== null &&
      ((isBodyRow && (index === activeIdx || index === activeIdx - 1)) ||
        (!isBodyRow && activeIdx === 0));

    return (
      <tr
        ref={(node) => {
          internalRef.current = node;
          setRef(ref, node);
        }}
        data-proximity-index={index}
        className={cn(
          "group/row relative z-10 border-b transition-[border-color] duration-80",
          hideBorder ? "border-transparent" : "border-accent/40",
          isBodyRow && activeIdx === index && "is-active",
          variant === "selected" && "bg-active/70",
          className,
        )}
        style={{
          ...style,
          fontVariationSettings: isBodyRow ? fontWeights.normal : fontWeights.semibold,
        }}
        {...props}
      />
    );
  },
);

TableRow.displayName = "TableRow";

// ── TableHead ────────────────────────────────────────────

/** Renders a table column heading. */
const TableHead = forwardRef<HTMLTableCellElement, ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <th ref={ref} className={cn("px-3 py-2 text-left text-foreground", className)} {...props} />
  ),
);

TableHead.displayName = "TableHead";

// ── TableCell ────────────────────────────────────────────

/** Renders a table data cell. */
const TableCell = forwardRef<HTMLTableCellElement, TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td
      ref={ref}
      className={cn(
        "px-3 py-2 text-muted-foreground transition-colors duration-80 group-[.is-active]/row:text-foreground",
        className,
      )}
      {...props}
    />
  ),
);

TableCell.displayName = "TableCell";

type TableCheckboxProps = ComponentProps<typeof Checkbox>;

function TableCheckHead(props: TableCheckboxProps) {
  return (
    <TableHead className="w-10 px-3">
      <Checkbox {...props} />
    </TableHead>
  );
}

function TableCheckCell(props: TableCheckboxProps) {
  return (
    <TableCell className="w-10 px-3">
      <Checkbox {...props} />
    </TableCell>
  );
}

// ── Exports ──────────────────────────────────────────────

export {
  Table,
  TableBody,
  TableCell,
  TableCheckCell,
  TableCheckHead,
  TableHead,
  TableHeader,
  TableRow,
};
