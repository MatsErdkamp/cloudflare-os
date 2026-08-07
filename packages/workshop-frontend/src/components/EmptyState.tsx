import { Button } from '@matser/ui'
import { PlugsConnected, type Icon } from '@phosphor-icons/react'
export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
  icon: EmptyIcon = PlugsConnected,
}: {
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
  icon?: Icon
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-dashed border-border bg-background px-6 py-9 text-center">
      <div
        className="themed-accent-glow pointer-events-none absolute left-1/2 top-1/2 h-48 w-48 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          filter: 'blur(14px)',
        }}
      />
      <div className="themed-user-bubble-shadow relative mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground">
        <EmptyIcon size={18} />
      </div>
      <div className="relative">
        <p className="m-0 text-[14px] leading-5 font-medium tracking-[-0.3px] text-foreground">
          {title}
        </p>
        <p className="mx-auto mt-1 max-w-sm text-[13px] leading-[18px] font-normal tracking-[-0.25px] text-muted-foreground">
          {description}
        </p>
      </div>
      {actionLabel && onAction && (
        <Button
          className="inline-flex cursor-pointer items-center justify-center rounded-lg text-[13px] leading-[18px] font-medium tracking-[-0.25px] transition-[background-color,color,opacity,transform] duration-150 ease-out active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 !h-8 border border-border bg-background px-3 text-foreground enabled:hover:bg-card disabled:opacity-40 relative mx-auto mt-4"
          onClick={onAction}
         variant="secondary">
          {actionLabel}
        </Button>
      )}
    </div>
  )
}
