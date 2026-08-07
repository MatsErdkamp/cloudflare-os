import {useState, useEffect } from 'react'
import {
  Pencil,
  Trash,
  Blueprint,
  Warning,
  X,
} from '@phosphor-icons/react'
import { RpcStub } from 'capnweb'
import { Overseer, GadgetClient, GadgetBindingInfo, BoundHookInfo, AuthenticatedApi } from '@gadgets/workshop-shared/api'
import type { WorkpieceId } from '@gadgets/workshop-shared/api'
import { GatekeeperIcon } from './components/GatekeeperIcon'
import { HookToggle } from './components/HookToggle'
import { useVendorBranding } from './useVendorBranding'
import { EmptyState } from './components/EmptyState'
import {
  BindingCardData,
  BlueprintBindingCard,
  loadBindingCardData,
} from './components/BlueprintBindingCard'
import { reportIssue } from './errorReporting'
import { Dialog, Tooltip, useToast, DialogContent, DialogTitle, DialogDescription, DialogClose, TooltipContent, TooltipTrigger, Button, Input} from '@matser/ui'
interface ConnectionsProps {
  overseer: RpcStub<Overseer>
  gadget: RpcStub<GadgetClient>
  // The chat currently open in the editor, if any. Connecting a resource with a chat open makes
  // the new binding provisional to that chat, exactly like a code edit: it works in the chat's
  // preview immediately, and becomes permanent only when the user accepts the chat's changes.
  chatId?: number
  authenticatedApi: RpcStub<AuthenticatedApi>
  onConnectionsChange?: () => void
  isVisible?: boolean
  onHasGatekeepersChange?: (hasGatekeepers: boolean) => void
}

// Auto-approval rules live in Activity because they apply across the workspace, while this view is
// scoped to one gadget.
export default function Connections({ overseer, gadget, chatId, authenticatedApi, onConnectionsChange, isVisible, onHasGatekeepersChange }: ConnectionsProps) {
  const [bindings, setBindings] = useState<GadgetBindingInfo[]>([])
  const [hooks, setHooks] = useState<BoundHookInfo[]>([])
  const vendorBranding = useVendorBranding(authenticatedApi)
  const [loading, setLoading] = useState(true)
  const [editingBinding, setEditingBinding] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<{
    name: string
    target: WorkpieceId
    targetType: GadgetBindingInfo['targetType']
    resourceTitle: string
  } | null>(null)
  const [deleteHookTarget, setDeleteHookTarget] = useState<{ id: number; title: string } | null>(null)
  const [togglingHooks, setTogglingHooks] = useState<Set<number>>(new Set())
  const [annotationTarget, setAnnotationTarget] = useState<GadgetBindingInfo | null>(null)
  const toasts = useToast()

  const loadGatekeepers = async () => {
    try {
      const [id, bindingList, hookList] = await Promise.all([
        gadget.getId(),
        // Pass the open chat so bindings this tab added provisionally to it are listed too.
        gadget.listBindings(chatId),
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
  }, [overseer, chatId])

  // Re-load when the tab becomes visible, so hooks enabled elsewhere (e.g. from the Activity log)
  // show up without a full page reload.
  useEffect(() => {
    if (isVisible) loadGatekeepers()
  }, [isVisible])


  const handleEditStart = (name: string) => {
    setEditingBinding(name)
    setEditValue(name)
  }

  const handleEditSave = async (name: string) => {
    const newName = editValue.trim()
    if (!newName) {
      toasts.add({ title: 'Binding name cannot be empty', type: 'error' })
      return
    }
    if (newName === name) {
      setEditingBinding(null)
      return
    }

    try {
      await gadget.renameBinding(name, newName)
      await loadGatekeepers()
      onConnectionsChange?.()
    } catch (err) {
      console.error('Failed to rename binding:', err)
      toasts.add({ title: 'Failed to update binding name', type: 'error' })
    } finally {
      setEditingBinding(null)
    }
  }

  const handleEditCancel = () => {
    setEditingBinding(null)
    setEditValue('')
  }

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return
    try {
      if (deleteTarget.targetType === 'contract') {
        await overseer.deleteContract(deleteTarget.target)
      } else {
        await gadget.unbind(deleteTarget.name)
      }
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
              {bindings.map((gk, index) => {
                const isEditing = editingBinding === gk.name
                const isDeleting = deleteTarget?.name === gk.name
                // Still provisional to the open chat (see GadgetBindingInfo.chatId). Blueprint
                // annotations are excluded, since a blueprint only ever exports permanent edges.
                const isPending = gk.chatId !== undefined

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
                            {gk.targetType === 'contract'
                              ? 'Its bindings, callbacks, facet storage, and pending operations will be retracted.'
                              : <>The legacy Source binding <span className="font-mono">{gk.name}</span> will be removed.</>}
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
                    ) : isEditing ? (
                      <div className="flex items-center gap-2">
                        <Input
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleEditSave(gk.name)
                            if (e.key === 'Escape') handleEditCancel()
                          }}
                          placeholder="Binding name"
                          aria-label="Binding name"
                          autoFocus
                          className="!h-9 rounded-lg border border-border bg-background px-3 text-[13px] leading-[18px] font-normal tracking-[-0.25px] text-foreground placeholder:text-muted-foreground shadow-none focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring/15 min-w-0 flex-1 font-mono"
                        />
                        <Button

                          className="inline-flex cursor-pointer items-center justify-center rounded-lg text-[13px] leading-[18px] font-medium tracking-[-0.25px] transition-[background-color,color,opacity,transform] duration-150 ease-out active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 !h-9 bg-foreground px-3 text-primary-foreground enabled:hover:bg-foreground disabled:opacity-50 !h-8"
                          onClick={() => handleEditSave(gk.name)}
                          disabled={!editValue.trim()}
                         variant="primary">
                          Save
                        </Button>
                        <Button
                          onClick={handleEditCancel}
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
                              {gk.targetType === 'contract' ? 'Contract' : gk.targetType === 'source' ? 'Source · legacy' : 'Gadget'}
                            </span>
                            {isPending && (
                              <Tooltip>
                                <TooltipTrigger render={<span className="flex-shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-[10px] leading-none font-medium text-muted-foreground">
                                  Draft
                                </span>} />
                                <TooltipContent>{"Added in this chat; kept when you accept the chat's changes"}</TooltipContent>
                              </Tooltip>
                            )}
                          </p>
                          <p className="mt-0.5 truncate text-[11px] leading-4 tracking-[-0.1px] text-muted-foreground">
                            Referenced in code as: <span className="font-mono text-muted-foreground">{gk.name}</span>
                          </p>
                        </div>
                        <div className="ml-auto flex shrink-0 items-center gap-1">
                          <Tooltip>
                            <TooltipTrigger render={<Button
                              onClick={() => handleEditStart(gk.name)}
                              aria-label="Edit name used in code"
                             className="!flex !h-8 !w-8 shrink-0 cursor-pointer items-center justify-center rounded-md !p-0 transition-[background-color,color,opacity,transform] duration-150 ease-out active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100" variant="ghost" size="icon-sm">
                              <Pencil size={14} />
                            </Button>} />
                            <TooltipContent>{"Edit name used in code"}</TooltipContent>
                          </Tooltip>
                          {!isPending && gk.targetType !== 'contract' && (
                            <Tooltip>
                              <TooltipTrigger render={<Button
                                onClick={() => setAnnotationTarget(gk)}
                                aria-label="Edit blueprint settings"
                               className="!flex !h-8 !w-8 shrink-0 cursor-pointer items-center justify-center rounded-md !p-0 transition-[background-color,color,opacity,transform] duration-150 ease-out active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100" variant="ghost" size="icon-sm">
                                <Blueprint size={14} />
                              </Button>} />
                              <TooltipContent>{"Edit blueprint settings"}</TooltipContent>
                            </Tooltip>
                          )}
                          <Tooltip>
                            <TooltipTrigger render={<Button

                              onClick={() => setDeleteTarget({
                                name: gk.name,
                                target: gk.target,
                                targetType: gk.targetType,
                                resourceTitle: gk.resourceTitle,
                              })}
                              aria-label={gk.targetType === 'contract' ? 'Retract Contract' : 'Delete connection'}
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

      <BlueprintAnnotationModal
        target={annotationTarget}
        gadget={gadget}
        onClose={() => setAnnotationTarget(null)}
        onSaved={() => {
          toasts.add({ title: 'Blueprint settings saved.', type: 'success' })
          setAnnotationTarget(null)
        }}
      />

    </div>
  )
}

function BlueprintAnnotationModal({
  target,
  gadget,
  onClose,
  onSaved,
}: {
  target: GadgetBindingInfo | null
  gadget: RpcStub<GadgetClient>
  onClose: () => void
  onSaved: () => void
}) {
  const [data, setData] = useState<BindingCardData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (!target) {
      setData(null)
      setLoadError(null)
      setSaveError(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const loaded = await loadBindingCardData(gadget, target)
        if (!cancelled) {
          if (loaded) {
            setData(loaded)
          } else {
            setLoadError('Connection not found.')
          }
        }
      } catch (err: any) {
        if (!cancelled) {
          reportIssue('connections.binding-load', err)
          setLoadError(err?.message || 'Could not load binding.')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [target, gadget])

  const handleSave = async () => {
    if (!data || !target) return
    setSaving(true)
    setSaveError(null)
    try {
      await gadget.setBlueprintAnnotation(target.name, data.annotation)
      onSaved()
    } catch (err: any) {
      reportIssue('connections.binding-save', err)
      setSaveError(err?.message || 'Could not save.')
    } finally {
      setSaving(false)
    }
  }

  const open = target !== null

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
        <DialogContent className="!z-[1000] !w-[min(480px,calc(100vw-32px))] overflow-hidden bg-background p-0" size="lg">
          <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-4 sm:px-5">
            <div className="min-w-0">
              <DialogTitle className="text-[15px] leading-5 font-medium tracking-[-0.3px] text-foreground">
                Blueprint settings
              </DialogTitle>
              <DialogDescription className="mt-1 text-[12px] leading-4 font-normal tracking-[-0.2px] text-muted-foreground">
                How this connection appears in blueprints.
              </DialogDescription>
            </div>
            <DialogClose
              render={(props) => (
                <Button {...props} aria-label="Close" className="!flex !h-8 !w-8 shrink-0 cursor-pointer items-center justify-center rounded-md !p-0 transition-[background-color,color,opacity,transform] duration-150 ease-out active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100" variant="ghost" size="icon-sm">
                  <X size={16} />
                </Button>
              )}
            />
          </div>

          <div className="space-y-4 px-4 py-4 sm:px-5">
            {loadError ? (
              <div className="text-[13px] text-muted-foreground">{loadError}</div>
            ) : !data ? (
              <div className="py-2 text-center text-[13px] text-muted-foreground">Loading...</div>
            ) : (
              <>
                <BlueprintBindingCard
                  data={data}
                  onChange={(annotation) => setData({ ...data, annotation })}
                  autoFocusDescription
                  flat
                />
              </>
            )}
          </div>

          <div className="border-t border-border px-4 py-3 sm:px-5">
            {saveError && (
              <div className="mb-3 flex items-start gap-2 rounded-lg border border-l-2 border-l-primary border-y-border border-r-border bg-background px-3 py-2 text-[12px] leading-[18px] font-normal tracking-[-0.2px] text-foreground">
                <Warning size={14} weight="fill" className="mt-0.5 shrink-0 text-primary" />
                <span>{saveError}</span>
              </div>
            )}
            <div className="flex items-center justify-end gap-2">
              <Button
                onClick={onClose}
                disabled={saving}
               className="inline-flex cursor-pointer items-center justify-center rounded-lg text-[13px] leading-[18px] font-medium tracking-[-0.25px] transition-[background-color,color,opacity,transform] duration-150 ease-out active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 !h-8 border border-border bg-background px-3 text-foreground enabled:hover:bg-card disabled:opacity-40" variant="secondary">
                Cancel
              </Button>
              <Button

                onClick={handleSave}
                disabled={saving || !data}
               className="inline-flex cursor-pointer items-center justify-center rounded-lg text-[13px] leading-[18px] font-medium tracking-[-0.25px] transition-[background-color,color,opacity,transform] duration-150 ease-out active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 !h-9 bg-foreground px-3 text-primary-foreground enabled:hover:bg-foreground disabled:opacity-50" variant="primary">
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
