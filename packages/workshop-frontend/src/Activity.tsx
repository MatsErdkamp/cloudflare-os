import {useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CaretRight, Check, Eye, Lightning, ShieldCheck } from '@phosphor-icons/react'
import { RpcStub } from 'capnweb'
import { ActionLogEntry, ContractOperationSummary, Overseer } from '@gadgets/workshop-shared/api'
import { ActionKind } from '@gadgets/workshop-shared/gatekeeper'
import { GatekeeperIcon } from './components/GatekeeperIcon'
import { HookToggle } from './components/HookToggle'
import { AlwaysApproveButton, ResolveButton } from './components/ResolveButton'
import { useActions } from './useActions'
import { useAutoApproval, autoApprovalKey, type AutoApprovalEntry } from './useAutoApproval'
import { useAlwaysApproveTag } from './useAlwaysApproveTag'
import { useAuthenticatedApi } from './AuthContext'
import { useAvatar } from './useAvatar'
import { useVendorBranding } from './useVendorBranding'
import { useResolveAction } from './useResolveAction'
import { safeExternalUrl } from './utils/safeExternalUrl'
import AutoApproveConfirmDialog from './components/AutoApproveConfirmDialog'
import { Switch, useToast, Button } from '@matser/ui'
export type ActivityView = 'review' | 'history' | 'auto'

type HistoryFilter = 'all' | ActionLogEntry['type']

const PANE_BAR = 'flex h-9 flex-shrink-0 items-center border-b border-border'

interface ActivityProps {
  overseer: RpcStub<Overseer>
  view: ActivityView
  onViewChange: (view: ActivityView) => void
  onAutoApproveChange?: () => void
  // Bumped when a rule is enabled from somewhere else (a pending row in chat), so the rule list
  // reflects it without being reopened.
  autoApproveReloadTrigger?: number
}

const HISTORY_FILTERS: { value: HistoryFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'action', label: 'Actions' },
  { value: 'observation', label: 'Observations' },
  { value: 'bindHook', label: 'Hooks' },
]

function timeValue(date: Date | undefined): number {
  return date ? new Date(date).getTime() : 0
}

function formatClockTime(date: Date): string {
  return new Date(date).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function formatFullDate(date: Date): string {
  return new Date(date).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function formatRelativeTime(date: Date): string {
  const minutes = Math.floor(Math.max(0, Date.now() - new Date(date).getTime()) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function dayLabel(date: Date): string {
  const value = new Date(date)
  const days = Math.round((startOfDay(new Date()) - startOfDay(value)) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return value.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })
}

function activityStatus(
  record: ActionLogEntry,
): { label: string; dotClass: string; textClass: string } {
  if (record.type === 'observation') {
    return { label: 'Observed', dotClass: 'bg-muted-foreground', textClass: 'text-muted-foreground' }
  }
  if (record.type === 'bindHook') {
    if (record.hookId === undefined) {
      return { label: 'Deleted', dotClass: 'bg-muted-foreground', textClass: 'text-muted-foreground' }
    }
    return record.enabled
      ? { label: 'Enabled', dotClass: 'bg-status-success', textClass: 'text-muted-foreground' }
      : { label: 'Disabled', dotClass: 'bg-muted-foreground', textClass: 'text-muted-foreground' }
  }
  if (record.state === 'pending') {
    return { label: 'Waiting', dotClass: 'bg-primary', textClass: 'text-foreground' }
  }
  if (record.state === 'rejected') {
    return { label: 'Denied', dotClass: 'bg-destructive', textClass: 'text-destructive' }
  }
  return { label: 'Approved', dotClass: 'bg-status-success', textClass: 'text-muted-foreground' }
}

function TypeIcon({ record, className }: { record: ActionLogEntry; className?: string }) {
  const props = { size: 13, weight: 'bold' as const, className }
  if (record.type === 'observation') return <Eye {...props} />
  if (record.type === 'bindHook') return <Lightning {...props} />
  return <ShieldCheck {...props} />
}

export default function Activity({
  overseer,
  view,
  onViewChange,
  onAutoApproveChange,
  autoApproveReloadTrigger,
}: ActivityProps) {
  const { actionsById, isReady } = useActions(overseer)
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all')
  const [processingActions, setProcessingActions] = useState<Set<number>>(new Set())
  const [togglingHooks, setTogglingHooks] = useState<Set<number>>(new Set())
  const [expandedActionId, setExpandedActionId] = useState<number | null>(null)
  const [contractOperations, setContractOperations] = useState<ContractOperationSummary[]>([])
  const [processingOperations, setProcessingOperations] = useState<Set<string>>(new Set())
  const [confirmAutoApprove, setConfirmAutoApprove] = useState<{
    actionId: number
    gatekeeperId: number
    resourceTitle: string
    actionKind: ActionKind
    actionLabel: string
  } | null>(null)
  const toasts = useToast()

  useEffect(() => {
    let disposed = false
    const load = async () => {
      try {
        const operations = await overseer.listContractOperations()
        if (!disposed) setContractOperations(operations)
      } catch (error) {
        if (!disposed) console.error('Failed to load Contract operations:', error)
      }
    }
    void load()
    const timer = window.setInterval(() => void load(), view === 'review' ? 2_000 : 10_000)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [overseer, view, actionsById.size])

  const pendingContractOperations = useMemo(() => contractOperations
    .filter(operation => operation.state === 'pending' || operation.state === 'applying')
    .toSorted((a, b) => timeValue(a.createdAt) - timeValue(b.createdAt)), [contractOperations])
  const resolvedContractOperations = useMemo(() => contractOperations
    .filter(operation => operation.state !== 'pending' && operation.state !== 'applying')
    .toSorted((a, b) => timeValue(b.decidedAt ?? b.createdAt) - timeValue(a.decidedAt ?? a.createdAt)),
  [contractOperations])

  const { pendingActions, historyGroups, historyTotal, historyShown } = useMemo(() => {
    const records = [...actionsById.values()]
    const pending = records
      .filter(record => record.state === 'pending' &&
        record.contractAttribution?.contractOperationId === undefined &&
        (record.type !== 'action' || record.contractPreapproved !== true ||
          record.contractApplyFailed === true))
      .toSorted((a, b) => timeValue(a.createdAt) - timeValue(b.createdAt) || a.id - b.id)
    const resolved = records.filter(record => record.state !== 'pending' &&
      record.contractAttribution?.contractOperationId === undefined)
    const filtered = resolved
      .filter(record => historyFilter === 'all' || record.type === historyFilter)
      .toSorted((a, b) =>
        timeValue(b.appliedAt ?? b.createdAt) - timeValue(a.appliedAt ?? a.createdAt) || b.id - a.id)
    const groups: { label: string; records: ActionLogEntry[] }[] = []
    for (const record of filtered) {
      const label = dayLabel(record.appliedAt ?? record.createdAt)
      const last = groups.at(-1)
      if (last?.label === label) last.records.push(record)
      else groups.push({ label, records: [record] })
    }
    return {
      pendingActions: pending,
      historyGroups: groups,
      historyTotal: resolved.length,
      historyShown: filtered.length,
    }
  }, [actionsById, historyFilter])

  const visibleResolvedContractOperations = historyFilter === 'all' || historyFilter === 'action'
    ? resolvedContractOperations
    : []
  const visibleHistoryTotal = historyShown + visibleResolvedContractOperations.length
  const allHistoryTotal = historyTotal + resolvedContractOperations.length

  const resolveAction = useResolveAction(overseer, setProcessingActions)

  const resolveContractOperation = async (operationId: string, decision: 'approve' | 'reject') => {
    setProcessingOperations(previous => new Set(previous).add(operationId))
    try {
      if (decision === 'approve') await overseer.approveContractOperation(operationId)
      else await overseer.rejectContractOperation(operationId)
      setContractOperations(await overseer.listContractOperations())
    } catch (error) {
      console.error(`Failed to ${decision} Contract operation:`, error)
      toasts.add({title: `Failed to ${decision} Contract operation`, type: 'error'})
    } finally {
      setProcessingOperations(previous => {
        const next = new Set(previous)
        next.delete(operationId)
        return next
      })
    }
  }

  const handleToggleHook = async (hookId: number, enabled: boolean) => {
    setTogglingHooks(previous => new Set(previous).add(hookId))
    try {
      if (enabled) await overseer.enableHook(hookId)
      else await overseer.disableHook(hookId)
    } catch (error) {
      console.error('Failed to toggle hook:', error)
      toasts.add({ title: `Failed to ${enabled ? 'enable' : 'disable'} hook`, type: 'error' })
    } finally {
      setTogglingHooks(previous => {
        const next = new Set(previous)
        next.delete(hookId)
        return next
      })
    }
  }

  const { alwaysApproveTag, isTagAutoApproved } =
    useAlwaysApproveTag(overseer, setProcessingActions, onAutoApproveChange)

  const toggleExpanded = (id: number) => {
    setExpandedActionId(previous => (previous === id ? null : id))
  }

  if (!isReady) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-muted-foreground">
        Loading activity…
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-background">
      {view === 'review' ? (
        pendingActions.length === 0 && pendingContractOperations.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-muted text-muted-foreground">
              <Check size={17} weight="bold" />
            </span>
            <p className="mt-3 text-[13px] font-medium leading-[18px] tracking-[-0.25px] text-foreground">
              Nothing to review
            </p>
            <p className="mt-1 max-w-xs text-[13px] leading-[18px] tracking-[-0.25px] text-muted-foreground">
              Requests that need your approval show up here and in the workspace header.
            </p>
            <Button className="inline-flex cursor-pointer items-center justify-center rounded-lg text-[13px] leading-[18px] font-medium tracking-[-0.25px] transition-[background-color,color,opacity,transform] duration-150 ease-out active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 !h-8 border border-border bg-background px-3 text-foreground enabled:hover:bg-card disabled:opacity-40 mt-4" onClick={() => onViewChange('history')} variant="secondary">
              View history
            </Button>
          </div>
        ) : (
          <>
            <div className={`${PANE_BAR} gap-2 px-5`}>
              <span className="text-[12.5px] font-medium leading-[17px] tracking-[-0.15px] text-foreground">
                {pendingActions.length + pendingContractOperations.length}{' '}
                {pendingActions.length + pendingContractOperations.length === 1 ? 'request' : 'requests'} waiting
              </span>
              <span className="ml-auto text-[11.5px] leading-[17px] text-muted-foreground">Oldest first</span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {pendingContractOperations.map(operation => (
                <ContractOperationReview
                  key={operation.id}
                  operation={operation}
                  children={operation.childActionIds.flatMap(id => {
                    const action = actionsById.get(id)
                    return action ? [action] : []
                  })}
                  processing={processingOperations.has(operation.id)}
                  onApprove={() => void resolveContractOperation(operation.id, 'approve')}
                  onReject={() => void resolveContractOperation(operation.id, 'reject')}
                />
              ))}
              {pendingActions.map(record => {
                const autoApproveTarget =
                  record.type === 'action' && record.gatekeeperId !== undefined &&
                  record.description.actionKind !== undefined &&
                  record.description.autoApprovable === true
                    ? {
                        actionId: record.id,
                        gatekeeperId: record.gatekeeperId,
                        resourceTitle: record.resourceTitle,
                        actionKind: record.description.actionKind,
                        actionLabel: record.description.title,
                      }
                    : undefined
                return (
                  <ReviewRequest
                    key={record.id}
                    record={record}
                    expanded={expandedActionId === record.id}
                    processing={processingActions.has(record.id)}
                    onToggle={() => toggleExpanded(record.id)}
                    onApprove={() => void resolveAction(record.id, 'approve')}
                    onReject={() => void resolveAction(record.id, 'deny')}
                    onAlwaysApprove={
                      autoApproveTarget &&
                      !isTagAutoApproved(autoApproveTarget.gatekeeperId, autoApproveTarget.actionKind.tag)
                        ? () => setConfirmAutoApprove(autoApproveTarget)
                        : undefined
                    }
                  />
                )
              })}
            </div>
          </>
        )
      ) : view === 'history' ? (
        <>
          <div className={`${PANE_BAR} gap-1 px-3`}>
            {HISTORY_FILTERS.map(filter => (
              <button
                key={filter.value}
                type="button"
                onClick={() => setHistoryFilter(filter.value)}
                className={`flex h-6 cursor-pointer items-center rounded-md px-2 text-[12.5px] font-medium tracking-[-0.15px] transition-colors ${
                  historyFilter === filter.value
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {filter.label}
              </button>
            ))}
            <span className="ml-auto pr-2 text-[11.5px] leading-[17px] tabular-nums text-muted-foreground">
              {visibleHistoryTotal} {visibleHistoryTotal === 1 ? 'event' : 'events'}
            </span>

          </div>

          {allHistoryTotal === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
              <p className="m-0 text-[13px] font-medium leading-[18px] tracking-[-0.25px] text-foreground">
                No activity yet
              </p>
              <p className="mt-1 max-w-xs text-[13px] leading-[18px] tracking-[-0.25px] text-muted-foreground">
                Every resource an agent reads or changes is recorded here.
              </p>
            </div>
          ) : visibleHistoryTotal === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
              <p className="m-0 text-[13px] font-medium text-foreground">No matching events</p>
              <button
                type="button"
                onClick={() => setHistoryFilter('all')}
                className="mt-1.5 cursor-pointer text-[12px] font-medium text-muted-foreground hover:text-foreground"
              >
                Show all activity
              </button>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto">
              <div className="grid grid-cols-[54px_minmax(0,1fr)_auto_16px] items-center gap-3 border-b border-border bg-card/50 px-5 py-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                <span>Time</span>
                <span>Event</span>
                <span>Status</span>
                <span />
              </div>
              {visibleResolvedContractOperations.length > 0 && (
                <section>
                  <h3 className="sticky top-0 m-0 border-b border-border bg-background/90 px-5 py-1 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground backdrop-blur-sm">
                    Contract operations
                  </h3>
                  {visibleResolvedContractOperations.map(operation => (
                    <ContractOperationReview
                      key={operation.id}
                      operation={operation}
                      children={operation.childActionIds.flatMap(id => {
                        const action = actionsById.get(id)
                        return action ? [action] : []
                      })}
                      processing={false}
                    />
                  ))}
                </section>
              )}
              {historyGroups.map(group => (
                <section key={group.label}>
                  <h3 className="sticky top-0 m-0 border-b border-border bg-background/90 px-5 py-1 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground backdrop-blur-sm">
                    {group.label}
                  </h3>
                  {group.records.map(record => (
                    <HistoryRow
                      key={record.id}
                      record={record}
                      expanded={expandedActionId === record.id}
                      onToggle={() => toggleExpanded(record.id)}
                      togglingHook={record.type === 'bindHook' && record.hookId !== undefined
                        ? togglingHooks.has(record.hookId)
                        : false}
                      onToggleHook={handleToggleHook}
                    />
                  ))}
                </section>
              ))}
            </div>
          )}
        </>
      ) : (
        <AutoApprovalPanel overseer={overseer} reloadTrigger={autoApproveReloadTrigger} />
      )}

      {confirmAutoApprove && (
        <AutoApproveConfirmDialog
          open
          actionLabel={confirmAutoApprove.actionLabel}
          resourceTitle={confirmAutoApprove.resourceTitle}
          isProcessing={processingActions.has(confirmAutoApprove.actionId)}
          onOpenChange={open => { if (!open) setConfirmAutoApprove(null) }}
          onConfirm={async () => {
            const { actionId, gatekeeperId, actionKind } = confirmAutoApprove
            if (await alwaysApproveTag(actionId, gatekeeperId, actionKind)) {
              setConfirmAutoApprove(null)
            }
          }}
        />
      )}
    </div>
  )
}

function ContractOperationReview({
  operation,
  children,
  processing,
  onApprove,
  onReject,
}: {
  operation: ContractOperationSummary
  children: ActionLogEntry[]
  processing: boolean
  onApprove?: () => void
  onReject?: () => void
}) {
  return (
    <article className="border-b border-border px-5 py-4">
      <div className="flex items-start gap-3">
        <span className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full bg-muted text-primary">
          <ShieldCheck size={15} weight="fill" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-medium text-foreground">{operation.title}</div>
          <p className="mt-0.5 text-[12.5px] leading-[17px] text-muted-foreground">
            {operation.description}
          </p>
          <div className="mt-1 font-mono text-[10.5px] text-muted-foreground">
            Contract {operation.contractId} · {operation.artifactHash.slice(0, 24)}…
          </div>
          {operation.state !== 'pending' && operation.state !== 'applying' && (
            <div className="mt-1 text-[11px] font-medium text-muted-foreground">
              {operation.state === 'applied' || operation.state === 'approved' ? 'Approved' :
                operation.state === 'rejected' ? 'Denied' : 'Failed'}
            </div>
          )}
          {children.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[12px] font-medium text-foreground">
                {children.length} provider {children.length === 1 ? 'action' : 'actions'}
              </summary>
              <ul className="mt-1 space-y-1 pl-4 text-[12px] text-muted-foreground">
                {children.map(child => (
                  <li key={child.id}>
                    {child.type === 'action' ? child.description.title : child.resourceTitle}
                    <span className="ml-1 text-muted-foreground">({child.resourceTitle})</span>
                    <span className="ml-1 text-muted-foreground">
                      · {child.state === 'approved' ? 'applied' :
                        child.state === 'rejected' ? 'rejected' : 'pending'}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
        {onApprove && onReject && (
          <div className="flex flex-shrink-0 gap-2">
            <Button disabled={processing} onClick={onReject} className="inline-flex cursor-pointer items-center justify-center rounded-lg text-[13px] leading-[18px] font-medium tracking-[-0.25px] transition-[background-color,color,opacity,transform] duration-150 ease-out active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 !h-8 border border-border bg-background px-3 text-foreground enabled:hover:bg-card disabled:opacity-40" variant="secondary">Deny</Button>
            <Button  disabled={processing} onClick={onApprove} className="inline-flex cursor-pointer items-center justify-center rounded-lg text-[13px] leading-[18px] font-medium tracking-[-0.25px] transition-[background-color,color,opacity,transform] duration-150 ease-out active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 !h-9 bg-foreground px-3 text-primary-foreground enabled:hover:bg-foreground disabled:opacity-50" variant="primary">
              Approve
            </Button>
          </div>
        )}
      </div>
    </article>
  )
}

function AutoApprovalPanel({
  overseer,
  reloadTrigger,
}: {
  overseer: RpcStub<Overseer>
  reloadTrigger?: number
}) {
  const { entries, isLoading, loadError, pending, refresh, setEnabled } = useAutoApproval(overseer)
  const { authenticatedApi } = useAuthenticatedApi()
  const vendorBranding = useVendorBranding(authenticatedApi)

  const previousReloadTrigger = useRef(reloadTrigger)
  useEffect(() => {
    if (reloadTrigger === previousReloadTrigger.current) return
    previousReloadTrigger.current = reloadTrigger
    void refresh()
  }, [reloadTrigger, refresh])

  const groups = useMemo(() => {
    const byConnection = new Map<
      number,
      { gatekeeperId: number; title: string; vendorId?: string; entries: AutoApprovalEntry[] }
    >()
    for (const entry of entries) {
      const group = byConnection.get(entry.gatekeeperId)
      if (group) group.entries.push(entry)
      else {
        byConnection.set(entry.gatekeeperId, {
          gatekeeperId: entry.gatekeeperId,
          title: entry.resourceTitle,
          vendorId: entry.vendorId,
          entries: [entry],
        })
      }
    }
    for (const group of byConnection.values()) {
      group.title ||= 'Unavailable connection'
      group.entries = group.entries.toSorted((a, b) =>
        a.actionKind.label.localeCompare(b.actionKind.label))
    }
    return [...byConnection.values()].toSorted((a, b) => a.title.localeCompare(b.title))
  }, [entries])

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-muted-foreground">
        Loading auto-approval…
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <p className="m-0 text-[13px] font-medium leading-[18px] tracking-[-0.25px] text-foreground">
          {loadError ? 'Could not load auto-approval' : 'Nothing can run automatically'}
        </p>
        <p className="mt-1 max-w-xs text-[13px] leading-[18px] tracking-[-0.25px] text-muted-foreground">
          {loadError
            ? 'The current rules may be incomplete. Try loading them again.'
            : 'Action types appear here once a connected resource offers one its author marked safe to apply without review.'}
        </p>
        {loadError && (
          <Button className="inline-flex cursor-pointer items-center justify-center rounded-lg text-[13px] leading-[18px] font-medium tracking-[-0.25px] transition-[background-color,color,opacity,transform] duration-150 ease-out active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 !h-8 border border-border bg-background px-3 text-foreground enabled:hover:bg-card disabled:opacity-40 mt-4" onClick={() => void refresh()} variant="secondary">
            Retry
          </Button>
        )}
      </div>
    )
  }

  return (
    <>
      <div className={`${PANE_BAR} gap-3 px-5`}>
        <p className="m-0 min-w-0 flex-1 truncate text-[12.5px] leading-[17px] tracking-[-0.2px] text-muted-foreground">
          {loadError
            ? 'Some auto-approval options could not be loaded.'
            : 'Actions agents may take without asking. Everything else waits for your review.'}
        </p>
        {loadError && (
          <button
            type="button"
            onClick={() => void refresh()}
            className="cursor-pointer text-[12px] font-medium text-foreground hover:text-foreground"
          >
            Retry
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {groups.map(group => (
          <section key={group.gatekeeperId}>
            <div className="sticky top-0 flex items-center gap-2 border-b border-border bg-background/90 px-5 py-1.5 backdrop-blur-sm">
              <GatekeeperIcon
                vendorId={group.vendorId}
                {...(group.vendorId ? vendorBranding.get(group.vendorId) : undefined)}
                fallbackText={group.title}
                size={12}
                className="h-5 w-5 rounded-md [&>img]:p-px"
              />
              <h3 className="m-0 min-w-0 truncate text-[12px] font-medium leading-4 tracking-[-0.2px] text-muted-foreground">
                {group.title}
              </h3>
            </div>
            {group.entries.map(entry => {
              const key = autoApprovalKey(entry)
              const busy = pending.has(key)
              return (
                <div
                  key={key}
                  className="flex w-full items-center gap-3 border-b border-border/60 px-5 py-2.5 text-left"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] leading-[18px] font-medium tracking-[-0.25px] text-foreground">
                      {entry.actionKind.label}
                    </span>
                    <span className="mt-0.5 block text-[12px] leading-4 tracking-[-0.2px] text-muted-foreground">
                      {entry.orphaned
                        ? 'This connection no longer offers this action; the rule still applies.'
                        : entry.enabled
                          ? 'Applied without asking'
                          : 'Waits for your approval'}
                    </span>
                  </span>
                  <Switch
                    size="sm"
                    checked={entry.enabled}
                    disabled={busy}
                    aria-label={`${entry.enabled ? 'Disable' : 'Enable'} auto-approval for ${entry.actionKind.label}`}
                    onCheckedChange={enabled => void setEnabled(entry, enabled)}
                  />
                </div>
              )
            })}
          </section>
        ))}
      </div>
    </>
  )
}

function ReviewRequest({
  record,
  expanded,
  processing,
  onToggle,
  onApprove,
  onReject,
  onAlwaysApprove,
}: {
  record: ActionLogEntry
  expanded: boolean
  processing: boolean
  onToggle: () => void
  onApprove: () => void
  onReject: () => void
  onAlwaysApprove?: () => void
}) {
  const resourceUrl = safeExternalUrl(record.resourceUrl)
  return (
    <article className="border-b border-border px-5 py-3 transition-colors hover:bg-card/50">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
        <div className="min-w-[8rem] flex-1">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            className="flex max-w-full cursor-pointer items-center gap-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <h3 className="m-0 truncate text-[13px] font-medium leading-[18px] tracking-[-0.25px] text-foreground">
              {record.description.title}
            </h3>
            <CaretRight
              size={12}
              className={`flex-shrink-0 text-muted-foreground transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
            />
          </button>
          <p className="mt-0.5 truncate text-[11.5px] leading-4 tracking-[-0.1px] text-muted-foreground">
            {resourceUrl ? (
              <a
                href={resourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground hover:underline"
              >
                {record.resourceTitle}
              </a>
            ) : record.resourceTitle}
            <span className="px-1">·</span>
            {formatRelativeTime(record.createdAt)}
          </p>
        </div>
        <div className="ml-auto flex flex-shrink-0 items-center gap-0.5">
          {onAlwaysApprove && (
            <AlwaysApproveButton onClick={onAlwaysApprove} disabled={processing} />
          )}
          <ResolveButton tone="deny" onClick={onReject} disabled={processing} />
          <ResolveButton tone="approve" onClick={onApprove} disabled={processing} />
        </div>
      </div>

      {record.description.description && (
        <p className={`mt-1.5 max-w-2xl whitespace-pre-wrap text-[13px] leading-[18px] tracking-[-0.25px] text-muted-foreground ${expanded ? '' : 'line-clamp-2'}`}>
          {record.description.description}
        </p>
      )}
      {record.type === 'action' && record.contractApplyFailed === true && (
        <p className="mt-1.5 text-[12px] leading-4 text-destructive">
          The provider could not apply this preapproved action. Retry it or deny it.
        </p>
      )}
    </article>
  )
}

function HistoryRow({
  record,
  expanded,
  onToggle,
  togglingHook,
  onToggleHook,
}: {
  record: ActionLogEntry
  expanded: boolean
  onToggle: () => void
  togglingHook: boolean
  onToggleHook: (hookId: number, enabled: boolean) => void
}) {
  const resourceUrl = safeExternalUrl(record.resourceUrl)
  const resolvedBy = record.type === 'action' ? record.resolvedBy : undefined
  const autoApproved = record.type === 'action' && record.autoApproved === true
  const at = record.appliedAt ?? record.createdAt
  const status = activityStatus(record)

  return (
    <div className={expanded ? 'bg-card/30' : ''}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="group grid w-full cursor-pointer grid-cols-[54px_minmax(0,1fr)_auto_16px] items-center gap-3 border-b border-border/70 px-5 py-[7px] text-left transition-colors hover:bg-card/50"
      >
        <time className="text-[11.5px] tabular-nums leading-4 text-muted-foreground">
          {formatClockTime(at)}
        </time>
        <span className="flex min-w-0 items-center gap-2">
          <TypeIcon record={record} className="flex-shrink-0 text-muted-foreground" />
          <span className="truncate text-[13px] leading-[18px] tracking-[-0.25px] text-foreground">
            {record.description.title}
          </span>
          <span className="hidden flex-shrink-0 truncate text-[12px] leading-4 tracking-[-0.1px] text-muted-foreground sm:inline">
            {record.resourceTitle}
          </span>
        </span>
        <span className={`flex items-center gap-1.5 text-[11.5px] font-medium ${status.textClass}`}>
          <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${status.dotClass}`} />
          {status.label}
        </span>
        <CaretRight
          size={12}
          className={`text-muted-foreground transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
        />
      </button>

      {expanded && (
        <div className="border-b border-border/70 px-5 pb-3 pl-[86px] pt-1">
          {record.description.description && (
            <p className="m-0 whitespace-pre-wrap text-[13px] leading-[18px] tracking-[-0.25px] text-muted-foreground">
              {record.description.description}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11.5px] text-muted-foreground">
            <span>{formatFullDate(at)}</span>
            <span className="text-muted-foreground">{record.resourceTitle}</span>
            {resolvedBy && (
              <ResolverBadge profileId={resolvedBy.id}>
                {autoApproved ? `Auto-approved (${resolvedBy.name}'s rule)` : `By ${resolvedBy.name}`}
              </ResolverBadge>
            )}
            {resourceUrl && (
              <a
                href={resourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground hover:underline"
              >
                Open resource
              </a>
            )}
            {record.type === 'bindHook' && record.hookId !== undefined && (
              <HookToggle
                enabled={record.enabled}
                disabled={togglingHook}
                onToggle={enabled => onToggleHook(record.hookId!, enabled)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ResolverBadge({ profileId, children }: { profileId: string; children: ReactNode }) {
  const { authenticatedApi } = useAuthenticatedApi()
  const avatarUrl = useAvatar(authenticatedApi, profileId)
  return (
    <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
      {avatarUrl && (
        <img src={avatarUrl} alt="" className="h-3.5 w-3.5 flex-shrink-0 rounded-full object-cover" />
      )}
      <span className="truncate">{children}</span>
    </span>
  )
}
