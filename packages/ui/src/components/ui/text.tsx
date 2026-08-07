import { createElement, type ComponentPropsWithoutRef, type ElementType } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "#/lib/utils";

const textVariants = cva("min-w-0", {
  variants: {
    variant: {
      h1: "text-3xl font-semibold tracking-tight text-foreground",
      h2: "text-2xl font-semibold tracking-tight text-foreground",
      h3: "text-lg font-semibold tracking-tight text-foreground",
      body: "text-foreground",
      muted: "text-muted-foreground",
      success: "text-status-success",
      destructive: "text-destructive",
      mono: "font-mono text-foreground",
      "mono-muted": "font-mono text-muted-foreground",
    },
    size: { xs: "text-xs", sm: "text-sm", md: "text-base", lg: "text-lg" },
    weight: { normal: "font-normal", medium: "font-medium", semibold: "font-semibold" },
    truncate: { true: "truncate" },
  },
  defaultVariants: { variant: "body", size: "md", weight: "normal" },
});

type TextProps<T extends ElementType = "p"> = {
  as?: T;
} & VariantProps<typeof textVariants> &
  Omit<ComponentPropsWithoutRef<T>, "as" | "size">;

function Text<T extends ElementType = "p">({
  as,
  className,
  variant,
  size,
  weight,
  truncate,
  ...props
}: TextProps<T>) {
  return createElement(as ?? "p", {
    className: cn(textVariants({ variant, size, weight, truncate }), className),
    ...props,
  });
}

export { Text };
export type { TextProps };
