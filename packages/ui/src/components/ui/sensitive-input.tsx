"use client";

import { useState, type ComponentProps } from "react";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { cn } from "#/lib/utils";

function SensitiveInput({ className, ...props }: Omit<ComponentProps<typeof Input>, "type">) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input type={visible ? "text" : "password"} className={cn("pr-16", className)} {...props} />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="absolute top-1/2 right-1 h-7 -translate-y-1/2 px-2 text-xs"
        aria-pressed={visible}
        onClick={() => setVisible((current) => !current)}
      >
        {visible ? "Hide" : "Show"}
      </Button>
    </div>
  );
}

export { SensitiveInput };
