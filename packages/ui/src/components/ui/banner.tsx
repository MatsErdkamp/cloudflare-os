import type { HTMLAttributes, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "#/lib/utils";

const bannerVariants = cva("grid w-full gap-1 rounded-2xl border px-4 py-3 text-sm", {
  variants: {
    variant: {
      info: "border-border bg-card text-card-foreground",
      warning: "border-status-warning/30 bg-status-warning/10 text-foreground",
      destructive: "border-destructive/30 bg-destructive/10 text-destructive",
      neutral: "border-border bg-muted text-foreground",
    },
  },
  defaultVariants: { variant: "info" },
});

interface BannerProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "title">, VariantProps<typeof bannerVariants> {
  action?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  title?: ReactNode;
}

function Banner({
  action,
  children,
  className,
  description,
  icon,
  title,
  variant,
  ...props
}: BannerProps) {
  return (
    <div
      role={variant === "destructive" || variant === "warning" ? "alert" : "status"}
      className={cn(
        bannerVariants({ variant }),
        (icon || action) && "grid-cols-[auto_1fr_auto] items-start gap-x-3",
        className,
      )}
      {...props}
    >
      {icon && <div className="row-span-2 mt-0.5">{icon}</div>}
      <div className={cn(icon && "col-start-2")}>
        {title && <div className="font-medium">{title}</div>}
        {description && <div className="text-muted-foreground">{description}</div>}
        {children}
      </div>
      {action && <div className="row-span-2">{action}</div>}
    </div>
  );
}

export { Banner };
export type { BannerProps };
