"use client";

import { Field as FieldPrimitive } from "@base-ui/react/field";
import { cn } from "#/lib/utils";

function Field({ className, ...props }: FieldPrimitive.Root.Props) {
  return <FieldPrimitive.Root className={cn("grid gap-1.5", className)} {...props} />;
}

function FieldLabel({ className, ...props }: FieldPrimitive.Label.Props) {
  return (
    <FieldPrimitive.Label
      className={cn("text-sm font-medium text-foreground", className)}
      {...props}
    />
  );
}

function FieldDescription({ className, ...props }: FieldPrimitive.Description.Props) {
  return (
    <FieldPrimitive.Description
      className={cn("text-xs leading-5 text-muted-foreground", className)}
      {...props}
    />
  );
}

function FieldError({ className, ...props }: FieldPrimitive.Error.Props) {
  return (
    <FieldPrimitive.Error
      className={cn("text-xs leading-5 text-destructive", className)}
      {...props}
    />
  );
}

function FieldControl(props: FieldPrimitive.Control.Props) {
  return <FieldPrimitive.Control {...props} />;
}

export { Field, FieldControl, FieldDescription, FieldError, FieldLabel };
