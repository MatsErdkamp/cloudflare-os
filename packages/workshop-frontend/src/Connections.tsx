import {useState, useEffect } from 'react'
import {
  Trash,
} from '@phosphor-icons/react'
import { RpcStub } from 'capnweb'
import { Overseer, GadgetClient, GadgetBindingInfo, BoundHookInfo, AuthenticatedApi } from '@gadgets/workshop-shared/api'
import type { WorkpieceId } from '@gadgets/workshop-shared/api'
import { GatekeeperIcon } from './components/GatekeeperIcon'
import { HookToggle } from './components/HookToggle'
import { useVendorBranding } from './useVendorBranding'
import { EmptyState } from './components/EmptyState'
import { reportIssue } from './errorReporting'
import { Tooltip, useToast, TooltipContent, TooltipTrigger, Button } from '@matser/ui'
interface ConnectionsProps {
  overseer: RpcStub<Overseer>
  gadget: RpcStub<GadgetClient>
  authenticatedApi: RpcStub<AuthenticatedApi>
  onConnectionsChange?: () => void
  isVisible?: boolean
  onHasGatekeepersChange?: (hasGatekeepers: boolean) => void
}

// Auto-approval rules live in Activity because they apply across the workspace, while this view is
// scoped to one gadget.
export default function Connections({ overseer, gadget, authenticatedApi, onConnectionsChange, isVisible, onHasGatekeepersChange }: ConnectionsProps) {
  const [bindings, setBindings] = useState<GadgetBindingInfo[]>([])
  const [hooks, setHooks] = useState<BoundHookInfo[]>([])
  const vendorBranding = useVendorBranding(authenticatedApi)
  const [loading, setLoading] = useState(true)
  const [deleteTarget, setDeleteTarget] = useState<{
    name: string
    target: WorkpieceId
    targetType: GadgetBindingInfo['targetType']
    resourceTitle: string
  } | null>(null)
  const [deleteHookTarget, setDeleteHookTarget] = useState<{ id: number; title: string } | null>(null)
  const [togglingHooks, setTogglingHooks] = useState<Set<number>>(new Set())
  const toasts = useToast()

  const loadGatekeepers = async () => {
    try {
      const [id, bindingList, hookList] = await Promise.all([
        gadget.getId(),
        gadget.listBindings(),
        // Workspace-wide; filtered to this gadget below.
        overseer.listHooks(),
      ])
      setBindings(bindingList)
      // This tab shows one gadget, so drop hooks that wake a different one -- otherwise its
      // toggle/delete controls would operate on another gadget's hooks.
      setHooks(hookList.filter((hook) => hook.gadgetId === id))
      onHasGatekeepersChange?.(bindingList.length > 0)
    } catch (err) {
      console.error('Failed to load gatekeepers:', err)
      reportIssue('connections.load', err)
      toasts.add({ title: 'Failed to load connections', type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const handleToggleHook = async (id: number, enabled: boolean) => {
    // Optimistically reflect the new state.
    setHooks((prev) => prev.map((h) => (h.id === id ? { ...h, enabled } : h)))
    setTogglingHooks((prev) => new Set(prev).add(id))
    try {
      if (enabled) {
        await overseer.enableHook(id)
      } else {
        await overseer.disableHook(id)
      }
      await loadGatekeepers()
    } catch (err) {
      console.error('Failed to toggle hook:', err)
      toasts.add({ title: `Failed to ${enabled ? 'enable' : 'disable'} hook`, type: 'error' })
      // Revert optimistic update.
      setHooks((prev) => prev.map((h) => (h.id === id ? { ...h, enabled: !enabled } : h)))
    } finally {
      setTogglingHooks((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  const handleDeleteHookConfirm = async () => {
    if (!deleteHookTarget) return
    try {
      await overseer.deleteHook(deleteHookTarget.id)
      await loadGatekeepers()
    } catch (err) {
      console.error('Failed to delete hook:', err)
      toasts.add({ title: 'Failed to delete hook', type: 'error' })
    } finally {
      setDeleteHookTarget(null)
    }
  }

  useEffect(() => {
    loadGatekeepers()
  }, [overseer])

  // Re-load when the tab becomes visible, so hooks enabled elsewhere (e.g. from the Activity log)
  // show up without a full page reload.
  useEffect(() => {
    if (isVisible) loadGatekeepers()
  }, [isVisible])



  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return
    try {
      await overseer.deleteContract(deleteTarget.target)
      await loadGatekeepers()
      onConnectionsChange?.()
    } catch (err) {
      console.error('Failed to remove binding:', err)
      toasts.add({ title: 'Failed to remove connection', type: 'error' })
    } finally {
      setDeleteTarget(null)
    }
  }

  return (
    <div className="h-full overflow-auto bg-background">
      <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-4 py-5 sm:px-6">
        <section>
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="m-0 text-[17px] leading-6 font-medium tracking-[-0.35px] text-foreground">
                Connections
              </h2>
              <p className="mt-1 text-[13px] leading-[18px] font-normal tracking-[-0.25px] text-muted-foreground">
                Reviewed Contract capabilities this gadget can use.
              </p>
            </div>
          </div>

          {loading ? (
            <div className="rounded-xl border border-border bg-background px-4 py-6 text-center text-[13px] leading-[18px] font-normal tracking-[-0.25px] text-muted-foreground">
              Loading connections...
            </div>
          ) : bindings.length === 0 ? (
            <EmptyState
              title="No installed Contracts"
              description="Ask the Manager in chat to turn a private Source into a reviewed capability for this Gadget."
            />
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-background">
              {bindings.map((gk, index) => {                const isDeleting = deleteTarget?.name === gk.name
                return (
                  <div
                    key={gk.name}
                    className={`px-3 py-3 ${index > 0 ? 'border-t border-border' : ''} ${isDeleting ? 'bg-destructive-muted/40' : ''}`}
                  >
                    {isDeleting ? (
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] leading-[18px] font-medium tracking-[-0.25px] text-destructive">
                            Delete {gk.resourceTitle}?
                          </p>
                          <p className="truncate text-[12px] leading-4 font-normal tracking-[-0.2px] text-muted-foreground">
                            Its bindings, callbacks, facet storage, and pending operations will be retracted.
                          </p>
                        </div>
                        <Button

                          className="inline-flex cursor-pointer items-center justify-center rounded-lg text-[13px] leading-[18px] font-medium tracking-[-0.25px] transition-[background-color,color,opacity,transform] duration-150 ease-out active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 !h-8 bg-destructive px-3 text-white enabled:hover:opacity-90 disabled:opacity-50 min-w-[68px]"
                          onClick={handleDeleteConfirm}
                         variant="destructive">
                          Delete
                        </Button>
                        <Button
                          onClick={() => setDeleteTarget(null)}
                         className="inline-flex cursor-pointer items-center justify-center rounded-lg text-[13px] leading-[18px] font-medium tracking-[-0.25px] transition-[background-color,color,opacity,transform] duration-150 ease-out active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 !h-8 border border-border bg-background px-3 text-foreground enabled:hover:bg-card disabled:opacity-40" variant="secondary">
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <GatekeeperIcon
                          vendorId={gk.vendorId}
                          fallbackText={gk.resourceTitle || gk.name}
                          {...(gk.vendorId ? vendorBranding.get(gk.vendorId) : undefined)}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-2 truncate text-[13px] leading-[18px] font-medium tracking-[-0.25px] text-foreground">
                            <span className="min-w-0 truncate">{gk.resourceTitle}</span>
                            <span className="flex-shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] leading-none font-medium text-muted-foreground">
                              Contract
                            </span>
                          </p>
                          <p className="mt-0.5 truncate text-[11px] leading-4 tracking-[-0.1px] text-muted-foreground">
                            Referenced in code as: <span className="font-mono text-muted-foreground">{gk.name}</span>
                          </p>
                        </div>
                        <div className="ml-auto flex shrink-0 items-center gap-1">
                          <Tooltip>
                            <TooltipTrigger render={<Button

                              onClick={() => setDeleteTarget({
                                name: gk.name,
                                target: gk.target,
                                targetType: gk.targetType,
                                resourceTitle: gk.resourceTitle,
                              })}
                              aria-label="Retract Contract"
                             className="!flex !h-8 !w-8 shrink-0 cursor-pointer items-center justify-center rounded-md !p-0 transition-[background-color,color,opacity,transform] duration-150 ease-out active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 text-muted-foreground enabled:hover:bg-destructive-muted enabled:hover:text-destructive" variant="ghost" size="icon-sm">
                              <Trash size={14} />
                            </Button>} />
                            <TooltipContent>{"Delete connection"}</TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {!loading && hooks.length > 0 && (
          <section className="mt-8">
            <div className="mb-3">
              <h2 className="m-0 text-[17px] leading-6 font-medium tracking-[-0.35px] text-foreground">
                Hooks
              </h2>
              <p className="mt-1 text-[13px] leading-[18px] font-normal tracking-[-0.25px] text-muted-foreground">
                Callbacks that let connected resources wake up this gadget when events happen.
              </p>
            </div>

            <div className="overflow-hidden rounded-xl border border-border bg-background">
              {hooks.map((hook, index) => {
                const isDeleting = deleteHookTarget?.id === hook.id
                const vendorId = bindings.find((b) => b.target === hook.gatekeeperId)?.vendorId

                return (
                  <div
                    key={hook.id}
                    className={`px-3 py-3 ${index > 0 ? 'border-t border-border' : ''} ${isDeleting ? 'bg-destructive-muted/40' : ''}`}
                  >
                    {isDeleting ? (
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] leading-[18px] font-medium tracking-[-0.25px] text-destructive">
                            Delete hook "{hook.description.title}"?
                          </p>
                          <p className="truncate text-[12px] leading-4 font-normal tracking-[-0.2px] text-muted-foreground">
                            This permanently removes the hook. Future events will stop being delivered.
                          </p>
                        </div>
                        <Button

                          className="inline-flex cursor-pointer items-center justify-center rounded-lg text-[13px] leading-[18px] font-medium tracking-[-0.25px] transition-[background-color,color,opacity,transform] duration-150 ease-out active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 !h-8 bg-destructive px-3 text-white enabled:hover:opacity-90 disabled:opacity-50 min-w-[68px]"
                          onClick={handleDeleteHookConfirm}
                         variant="destructive">
                          Delete
                        </Button>
                        <Button
                          onClick={() => setDeleteHookTarget(null)}
                         className="inline-flex cursor-pointer items-center justify-center rounded-lg text-[13px] leading-[18px] font-medium tracking-[-0.25px] transition-[background-color,color,opacity,transform] duration-150 ease-out active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 !h-8 border border-border bg-background px-3 text-foreground enabled:hover:bg-card disabled:opacity-40" variant="secondary">
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <GatekeeperIcon
                          vendorId={vendorId}
                          fallbackText={hook.resourceTitle}
                          {...(vendorId ? vendorBranding.get(vendorId) : undefined)}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] leading-[18px] font-medium tracking-[-0.25px] text-foreground">
                            {hook.description.title}
                          </p>
                          {hook.description.description && (
                            <p className="mt-0.5 truncate text-[12px] leading-4 font-normal tracking-[-0.2px] text-muted-foreground">
                              {hook.description.description}
                            </p>
                          )}
                          {hook.resourceTitle && (
                            <p className="mt-0.5 truncate text-[11px] leading-4 tracking-[-0.1px] text-muted-foreground">
                              {hook.resourceTitle}
                            </p>
                          )}
                        </div>
                        <div className="ml-auto flex shrink-0 items-center gap-2">
                          <HookToggle
                            enabled={hook.enabled}
                            disabled={togglingHooks.has(hook.id)}
                            onToggle={(enabled) => handleToggleHook(hook.id, enabled)}
                          />
                          <Tooltip>
                            <TooltipTrigger render={<Button

                              onClick={() => setDeleteHookTarget({ id: hook.id, title: hook.description.title })}
                              aria-label="Delete hook"
                             className="!flex !h-8 !w-8 shrink-0 cursor-pointer items-center justify-center rounded-md !p-0 transition-[background-color,color,opacity,transform] duration-150 ease-out active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 text-muted-foreground enabled:hover:bg-destructive-muted enabled:hover:text-destructive" variant="ghost" size="icon-sm">
                              <Trash size={14} />
                            </Button>} />
                            <TooltipContent>{"Delete hook"}</TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}

      </div>

    </div>
  )
}
