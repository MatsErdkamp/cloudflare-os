"use client";

import {
  cloneElement,
  forwardRef,
  isValidElement,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import type { IconComponent } from "#/lib/icon-context";
import { roundedShape } from "#/lib/shape-tokens";
import { cn } from "#/lib/utils";

const buttonVariants = cva(
  [
    "group relative isolate inline-flex items-center justify-center outline-none cursor-pointer",
    "transition-colors duration-80",
    "disabled:opacity-50 disabled:pointer-events-none",
    "focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)]",
  ],
  {
    variants: {
      variant: {
        primary:
          "overflow-hidden whitespace-nowrap select-none text-[color:var(--fg-1)] font-medium transition-all duration-200 ease [box-shadow:0_2px_4px_0_var(--shadow-low),0_0_0_1px_var(--shadow-stroke-2)]",
        secondary: "text-foreground",
        tertiary: "border border-border text-foreground",
        outline: "border border-border bg-transparent text-foreground",
        ghost: "text-muted-foreground hover:text-foreground",
        destructive: "text-destructive-foreground",
      },
      size: {
        xs: "h-6 px-2.5 text-[11px] gap-1",
        sm: "h-7 px-3 text-[12px] gap-1",
        md: "h-8 px-4 text-[13px] gap-1.5",
        base: "h-9 px-3.5 text-[14px] gap-1.5",
        lg: "h-9 px-5 text-[14px] gap-1.5",
        "icon-sm": "h-8 w-8 p-0 [&_svg]:h-3.5 [&_svg]:w-3.5",
        icon: "h-9 w-9 p-0 [&_svg]:h-4 [&_svg]:w-4",
        "icon-lg": "h-10 w-10 p-0 [&_svg]:h-5 [&_svg]:w-5",
      },
      iconLeft: { true: "" },
      iconRight: { true: "" },
    },
    compoundVariants: [
      { variant: "primary", size: "md", className: "h-9 px-3.5 text-[14px]/none" },
      { variant: "primary", size: "lg", className: "px-3.5 text-[14px]/none" },
      { size: "sm", iconLeft: true, className: "pl-[6px]" },
      { size: "md", iconLeft: true, className: "pl-[10px]" },
      { size: "lg", iconLeft: true, className: "pl-[14px]" },
      { size: "sm", iconRight: true, className: "pr-[6px]" },
      { size: "md", iconRight: true, className: "pr-[10px]" },
      { size: "lg", iconRight: true, className: "pr-[14px]" },
    ],
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** When true, the given single React-element child becomes the rendered element (slot-style). */
  asChild?: boolean;
  loading?: boolean;
  leadingIcon?: IconComponent;
  trailingIcon?: IconComponent;
  /** Force the visual pressed/held state. Useful when the button drives an
   *  external open piece of UI (a popover, dropdown, etc.) so it reads as
   *  engaged while the menu is showing. */
  active?: boolean;
}

interface ButtonChildProps {
  children?: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  ref?: React.Ref<HTMLButtonElement>;
}

const bgVariants: Record<string, string> = {
  primary: "bg-[var(--bg-3)] group-hover:bg-[var(--bg-4)] group-active:bg-[var(--bg-2)]",
  secondary: "bg-accent group-hover:bg-accent/80 group-active:bg-accent",
  tertiary: "bg-transparent group-hover:bg-hover group-active:bg-active",
  outline: "bg-transparent group-hover:bg-hover group-active:bg-active",
  ghost: "bg-transparent group-hover:bg-hover group-active:bg-active",
  destructive: "bg-destructive group-hover:bg-destructive/90 group-active:bg-destructive/80",
};

const activeBgVariants: Record<string, string> = {
  primary: "bg-[var(--bg-2)]",
  secondary: "bg-accent",
  tertiary: "bg-active",
  outline: "bg-active",
  ghost: "bg-active",
  destructive: "bg-destructive/80",
};

/** Renders a rounded Fluid action or link with optional product icons. */
const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      loading = false,
      leadingIcon: LeadingIcon,
      trailingIcon: TrailingIcon,
      active = false,
      disabled,
      children,
      style,
      ...props
    },
    ref,
  ) => {
    // asChild: the user's element becomes the root while the button's internal
    // structure (bg layer, content wrapper, spinner, icons) survives as its
    // children — the element's own children become the label. We clone the
    // element directly instead of routing through ButtonPrimitive's `render`:
    // Base UI would bolt button semantics (role="button", Space activation)
    // onto e.g. a link, where plain-link output is wanted.
    const asChildElement = asChild && isValidElement<ButtonChildProps>(children) ? children : null;
    const label = asChildElement ? asChildElement.props.children : children;
    const isPlainLabel = typeof label === "string" || typeof label === "number";
    const isIconOnly = size === "icon" || size === "icon-sm" || size === "icon-lg";
    const iconSize = size === "sm" ? 14 : size === "lg" ? 20 : 16;
    // Spinner box tracks the button height (sm is h-7, lg/icon are h-9, …) so
    // the loading glyph stays proportionate across sizes.
    const spinnerSizeClass =
      size === "sm"
        ? "h-7 w-7"
        : size === "lg" || size === "icon"
          ? "h-9 w-9"
          : size === "icon-lg"
            ? "h-10 w-10"
            : "h-8 w-8";
    const bgClass = active
      ? activeBgVariants[variant ?? "primary"]
      : bgVariants[variant ?? "primary"];

    const internals = (
      <>
        <span
          aria-hidden
          className={cn(
            "absolute inset-0 rounded-[inherit] transition-[background-color,transform] group-active:scale-[0.98]",
            (variant ?? "primary") === "primary" ? "duration-200 ease" : "duration-80",
            bgClass,
          )}
        />
        <span
          data-slot="button-content"
          className={cn(
            "relative inline-flex min-w-0 gap-[inherit] [align-items:inherit] [flex-direction:inherit] [justify-content:inherit]",
            !isPlainLabel && "w-full",
          )}
        >
          {loading ? (
            <>
              <span className="flex items-center justify-center gap-[inherit] opacity-0">
                {LeadingIcon && !isIconOnly && <LeadingIcon size={iconSize} strokeWidth={2} />}
                {label}
                {TrailingIcon && !isIconOnly && <TrailingIcon size={iconSize} strokeWidth={2} />}
              </span>
              <span className="absolute inset-0 flex items-center justify-center">
                <svg className={spinnerSizeClass} viewBox="0 0 24 24" fill="none">
                  <path
                    d="M 12 12 C 14 8.5 19 8.5 19 12 C 19 15.5 14 15.5 12 12 C 10 8.5 5 8.5 5 12 C 5 15.5 10 15.5 12 12 Z"
                    stroke="currentColor"
                    strokeWidth="1.125"
                    strokeLinecap="round"
                    pathLength="100"
                    style={{
                      strokeDasharray: "15 85",
                      animation:
                        "spinner-move 2s linear infinite, spinner-dash 4s ease-in-out infinite",
                    }}
                  />
                </svg>
              </span>
            </>
          ) : isIconOnly ? (
            <span className="[&_svg]:stroke-[1.5] [&_svg]:transition-[stroke-width] [&_svg]:duration-80 group-hover:[&_svg]:stroke-[2]">
              {label}
            </span>
          ) : (
            <>
              {LeadingIcon && (
                <LeadingIcon
                  size={iconSize}
                  strokeWidth={1.5}
                  className="transition-[stroke-width] duration-80 group-hover:stroke-[2]"
                />
              )}
              {/* text-box only applies to block containers, so the trim lives
                  on the label span (a blockified flex item), not the flex root.
                  The button's height is fixed (h-*), so this doesn't change
                  layout — it just centers the cap-to-baseline box optically. */}
              {isPlainLabel ? (
                <span className="[text-box:trim-both_cap_alphabetic]">{label}</span>
              ) : (
                label
              )}
              {TrailingIcon && (
                <TrailingIcon
                  size={iconSize}
                  strokeWidth={1.5}
                  className="transition-[stroke-width] duration-80 group-hover:stroke-[2]"
                />
              )}
            </>
          )}
        </span>
      </>
    );

    const rootClassName = cn(
      buttonVariants({
        variant,
        size,
        iconLeft: !isIconOnly && !!LeadingIcon,
        iconRight: !isIconOnly && !!TrailingIcon,
      }),
      roundedShape.button,
      (variant ?? "primary") === "primary" && "rounded-full",
      className,
    );

    if (asChildElement) {
      const childProps = asChildElement.props;
      return cloneElement(
        asChildElement,
        {
          ...props,
          ref,
          className: cn(rootClassName, childProps.className),
          style: { ...style, ...childProps.style },
        },
        internals,
      );
    }

    return (
      <ButtonPrimitive
        ref={ref}
        className={rootClassName}
        disabled={disabled || loading}
        style={style}
        {...props}
      >
        {internals}
      </ButtonPrimitive>
    );
  },
);

Button.displayName = "Button";

export { Button };
