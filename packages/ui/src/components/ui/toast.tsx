"use client";

import { Toast as ToastPrimitive } from "@base-ui/react/toast";
import type { ComponentProps, ReactNode } from "react";
import { Button } from "#/components/ui/button";
import { Icons } from "#/lib/icons";
import { cn } from "#/lib/utils";

interface ToastData {
  children?: ReactNode;
}

const toast = ToastPrimitive.createToastManager<ToastData>();

function ToastList() {
  const manager = ToastPrimitive.useToastManager<ToastData>();
  return (
    <ToastPrimitive.Portal>
      <ToastPrimitive.Viewport className="fixed top-4 right-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2 outline-none">
        {manager.toasts.map((item) => (
          <ToastPrimitive.Root
            key={item.id}
            toast={item}
            className={cn(
              "relative rounded-2xl border bg-popover/90 p-4 pr-11 text-popover-foreground shadow-xl ring-1 ring-foreground/5 backdrop-blur-xl transition data-ending-style:translate-x-4 data-ending-style:opacity-0 data-starting-style:translate-x-4 data-starting-style:opacity-0",
              item.type === "error" && "border-destructive/30",
              item.type === "warning" && "border-status-warning/30",
              item.type === "success" && "border-status-success/30",
            )}
          >
            <ToastPrimitive.Content className="grid gap-1">
              {item.title && (
                <ToastPrimitive.Title className="text-sm font-medium">
                  {item.title}
                </ToastPrimitive.Title>
              )}
              {item.description && (
                <ToastPrimitive.Description className="text-xs leading-5 text-muted-foreground">
                  {item.description}
                </ToastPrimitive.Description>
              )}
              {item.data?.children}
              {item.actionProps && (
                <ToastPrimitive.Action
                  className="mt-2 inline-flex w-fit rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:bg-hover"
                  {...item.actionProps}
                />
              )}
            </ToastPrimitive.Content>
            <ToastPrimitive.Close
              aria-label="Dismiss notification"
              className="absolute top-2 right-2"
              render={<Button size="icon-sm" variant="ghost" />}
            >
              <Icons.X />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        ))}
      </ToastPrimitive.Viewport>
    </ToastPrimitive.Portal>
  );
}

interface ToasterProps extends Omit<ComponentProps<typeof ToastPrimitive.Provider>, "children"> {
  children?: ReactNode;
}

function Toaster({ children, toastManager = toast, ...props }: ToasterProps) {
  return (
    <ToastPrimitive.Provider toastManager={toastManager} {...props}>
      {children}
      <ToastList />
    </ToastPrimitive.Provider>
  );
}

const useToast = ToastPrimitive.useToastManager;

export { Toaster, toast, useToast };
export type { ToasterProps, ToastData };
