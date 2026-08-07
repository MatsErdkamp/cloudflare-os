import { useMemo, useState } from 'react'
import { ArrowRight, Pulse } from '@phosphor-icons/react'
import type { RpcStub } from 'capnweb'
import type { ActionLogEntry, Overseer } from '@gadgets/workshop-shared/api'
import { CountBadge } from './components/CountBadge'
import { ResolveButton } from './components/ResolveButton'
import { formatRelativeTime, type ActivityView } from './Activity'
import { useResolveAction } from './useResolveAction'
import { Popover, PopoverTrigger, PopoverContent, PopoverTitle } from '@matser/ui'
interface ActivityNotificationsProps {
  overseer: RpcStub<Overseer>
  pendingActions: ActionLogEntry[]
  onViewActivity: (view: ActivityView) => void
}

const PREVIEW_LIMIT = 3

export default function ActivityNotifications({
  overseer,
  pendingActions,
  onViewActivity,
}: ActivityNotificationsProps) {
  const [open, setOpen] = useState(false)
  const [processing, setProcessing] = useState<Set<number>>(new Set())
  const resolveAction = useResolveAction(overseer, setProcessing)

  const pending = useMemo(() => pendingActions.toSorted((a, b) =>
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id - b.id),
  [pendingActions])

  const openFullView = (view: ActivityView) => {
    setOpen(false)
    onViewActivity(view)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={pending.length > 0
              ? `Activity — ${pending.length} ${pending.length === 1 ? 'request needs' : 'requests need'} review`
              : 'Activity'}
            className={`relative flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              pending.length > 0 ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Pulse size={16} weight={pending.length > 0 ? 'bold' : 'regular'} />
            <CountBadge count={pending.length} tone="solid" className="absolute -right-0.5 -top-0.5" />
          </button>
        }
      />
      {/* the previous UI library always renders base-ui's arrow as the popup's first child; hide it so this sits flush
          like the header's profile menu, which has no arrow. */}
      <PopoverContent
        align="end"
        sideOffset={8}
        positionMethod="fixed"
        className="themed-floating-shadow !z-[1100] !w-[min(340px,calc(100vw-24px))] !min-w-0 overflow-hidden rounded-lg border border-border !outline-none bg-background !p-0 [&>:first-child]:hidden"
      >
        <div className="flex items-center justify-between gap-2 px-3.5 pb-1 pt-2.5">
          <PopoverTitle className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
            Needs review
          </PopoverTitle>
          <CountBadge count={pending.length} />
        </div>

        {pending.length === 0 ? (
          <p className="m-0 px-3.5 pb-3 pt-1 text-[13px] leading-[18px] tracking-[-0.25px] text-muted-foreground">
            Nothing is waiting on you.
          </p>
        ) : (
          <div className="max-h-[min(58vh,420px)] overflow-y-auto pb-1">
            {pending.slice(0, PREVIEW_LIMIT).map((action, index) => {
              const isProcessing = processing.has(action.id)
              return (
                <div
                  key={action.id}
                  className={`px-3.5 py-2.5 ${index === 0 ? '' : 'border-t border-border'}`}
                >
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      onClick={() => openFullView('review')}
                      className="min-w-[7rem] flex-1 cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="block truncate text-[13px] font-medium leading-[18px] tracking-[-0.25px] text-foreground">
                        {action.description.title}
                      </span>
                      <span className="mt-0.5 block truncate text-[11.5px] leading-4 tracking-[-0.1px] text-muted-foreground">
                        {action.resourceTitle}
                        <span className="px-1">·</span>
                        {formatRelativeTime(action.createdAt)}
                      </span>
                      <span className="mt-1.5 block line-clamp-2 text-[12.5px] leading-[18px] tracking-[-0.2px] text-muted-foreground">
                        {action.description.description}
                      </span>
                    </button>
                    <div className="ml-auto flex flex-shrink-0 items-center gap-0.5">
                      <ResolveButton
                        tone="deny"
                        disabled={isProcessing}
                        onClick={() => void resolveAction(action.id, 'deny')}
                      />
                      <ResolveButton
                        tone="approve"
                        disabled={isProcessing}
                        onClick={() => void resolveAction(action.id, 'approve')}
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <div className="border-t border-border p-1">
          <button
            type="button"
            onClick={() => openFullView(pending.length > 0 ? 'review' : 'history')}
            className="flex w-full cursor-pointer items-center justify-between rounded-md px-2.5 py-1.5 text-left text-[13px] leading-[18px] tracking-[-0.25px] text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <span>
              {pending.length > PREVIEW_LIMIT
                ? `View all ${pending.length} requests`
                : 'View all activity'}
            </span>
            <ArrowRight size={13} className="text-muted-foreground" />
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
