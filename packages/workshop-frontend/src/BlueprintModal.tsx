import {useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { ArrowsClockwise, Check, Copy, ImageSquare, Pencil, Plus, Trash, Warning, X } from '@phosphor-icons/react'
import { RpcStub } from 'capnweb'
import { BlueprintGadgetSummary, GadgetClient, GadgetMetadata, Overseer, BlueprintBindingAnnotation, BlueprintScreenshotUpload } from '@gadgets/workshop-shared/api'
import { copyToClipboard } from './clipboard'
import {
  BindingCardData,
  BlueprintBindingCard,
  loadBindingCardData,
} from './components/BlueprintBindingCard'
import { Dialog, useToast, DialogContent, DialogTitle, DialogDescription, DialogClose, Button, Input, Textarea} from '@matser/ui'
const BLUEPRINT_SCREENSHOT_WIDTH = 1280
const BLUEPRINT_SCREENSHOT_HEIGHT = 720
const MAX_BLUEPRINT_SCREENSHOT_BYTES = 700 * 1024

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob)
      else reject(new Error('Failed to encode image.'))
    }, type, quality)
  })
}

async function compressBlueprintScreenshot(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = BLUEPRINT_SCREENSHOT_WIDTH
  canvas.height = BLUEPRINT_SCREENSHOT_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Failed to get 2D canvas context')

  try {
    const targetRatio = BLUEPRINT_SCREENSHOT_WIDTH / BLUEPRINT_SCREENSHOT_HEIGHT
    const sourceRatio = bitmap.width / bitmap.height
    let sx = 0
    let sy = 0
    let sw = bitmap.width
    let sh = bitmap.height

    if (sourceRatio > targetRatio) {
      sw = bitmap.height * targetRatio
      sx = (bitmap.width - sw) / 2
    } else if (sourceRatio < targetRatio) {
      sh = bitmap.width / targetRatio
      sy = (bitmap.height - sh) / 2
    }

    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, BLUEPRINT_SCREENSHOT_WIDTH, BLUEPRINT_SCREENSHOT_HEIGHT)

    for (let quality = 0.86; quality >= 0.5; quality -= 0.12) {
      const blob = await canvasToBlob(canvas, 'image/jpeg', quality)
      if (blob.size <= MAX_BLUEPRINT_SCREENSHOT_BYTES) return blob
    }

    return canvasToBlob(canvas, 'image/jpeg', 0.42)
  } finally {
    bitmap.close()
  }
}

type Props = {
  open: boolean
  onClose: () => void
  overseer: RpcStub<Overseer>
  // The gadget this modal exports blueprints from (the gadget currently selected in the editor).
  gadget: RpcStub<GadgetClient>
  metadata: GadgetMetadata
}

export default function BlueprintModal({ open, onClose, overseer, gadget, metadata }: Props) {
  const toasts = useToast()

  const [blueprints, setBlueprints] = useState<BlueprintGadgetSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [formMode, setFormMode] = useState<'list' | 'create' | 'edit'>('list')
  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newScreenshotBlob, setNewScreenshotBlob] = useState<Blob | null>(null)
  const [newScreenshotUrl, setNewScreenshotUrl] = useState<string | null>(null)
  const [clearScreenshot, setClearScreenshot] = useState(false)
  const [processingScreenshot, setProcessingScreenshot] = useState(false)
  const screenshotInputRef = useRef<HTMLInputElement>(null)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [editingBlueprint, setEditingBlueprint] = useState<BlueprintGadgetSummary | null>(null)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const [bindings, setBindings] = useState<BindingCardData[]>([])
  const [bindingsLoading, setBindingsLoading] = useState(false)
  const [bindingsError, setBindingsError] = useState<string | null>(null)

  const loadBlueprints = useCallback(async () => {
    setLoading(true)
    try {
      setBlueprints(await overseer.listBlueprints())
    } catch (err) {
      console.error('Failed to load blueprints:', err)
      toasts.add({ title: 'Failed to load blueprints', type: 'error' })
    } finally {
      setLoading(false)
    }
  }, [overseer])

  const loadBindings = useCallback(async () => {
    setBindingsLoading(true)
    setBindingsError(null)
    try {
      // No chat scope: a blueprint exports only the gadget's permanent bindings, never a chat's
      // still-provisional additions.
      const list = await gadget.listBindings()
      const loaded = await Promise.all(list.map((b) => loadBindingCardData(gadget, b)))
      setBindings(loaded.filter((b): b is BindingCardData => b !== null))
    } catch (err) {
      console.error('Failed to load bindings:', err)
      setBindingsError('Could not load connections.')
    } finally {
      setBindingsLoading(false)
    }
  }, [gadget])

  useEffect(() => {
    if (open) {
      loadBlueprints()
      setFormMode('list')
      setNewTitle(metadata.title)
      setNewDescription('')
      setNewScreenshotBlob(null)
      setNewScreenshotUrl(null)
      setClearScreenshot(false)
      setCreateError(null)
    }
  }, [open, loadBlueprints, metadata.title])

  useEffect(() => {
    if (formMode !== 'list') {
      loadBindings()
    } else {
      setBindings([])
      setBindingsError(null)
      setCreateError(null)
    }
  }, [formMode, loadBindings])

  useEffect(() => {
    return () => {
      if (newScreenshotUrl) URL.revokeObjectURL(newScreenshotUrl)
    }
  }, [newScreenshotUrl])

  const handleScreenshotSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    if (!file.type.startsWith('image/')) {
      toasts.add({ title: 'Please select an image file.', type: 'error' })
      return
    }

    setProcessingScreenshot(true)
    try {
      const blob = await compressBlueprintScreenshot(file)
      setNewScreenshotBlob(blob)
      setNewScreenshotUrl(prev => {
        if (prev) URL.revokeObjectURL(prev)
        return URL.createObjectURL(blob)
      })
      setClearScreenshot(false)
    } catch (err) {
      console.error('Failed to process blueprint screenshot:', err)
      toasts.add({ title: 'Failed to process screenshot', type: 'error' })
    } finally {
      setProcessingScreenshot(false)
    }
  }

  const updateBindingAnnotation = (bindingName: string, annotation: BlueprintBindingAnnotation) => {
    setBindings((prev) =>
      prev.map((b) => (b.bindingName === bindingName ? { ...b, annotation } : b)),
    )
  }

  const createBlueprint = async () => {
    if (bindingsLoading) return
    setCreating(true)
    setCreateError(null)
    try {
      await Promise.all(
        bindings.map((b) => gadget.setBlueprintAnnotation(b.bindingName, b.annotation)),
      )

      const screenshot: BlueprintScreenshotUpload | undefined = newScreenshotBlob
        ? {
          mimeType: 'image/jpeg',
          content: new Uint8Array(await newScreenshotBlob.arrayBuffer()),
        }
        : undefined

      await gadget.createBlueprint(
        newTitle.trim() || undefined,
        newDescription.trim() || undefined,
        screenshot,
      )
      toasts.add({ title: 'Blueprint created.', type: 'success' })
      setFormMode('list')
      setNewTitle(metadata.title)
      setNewDescription('')
      setNewScreenshotBlob(null)
      setNewScreenshotUrl(null)
      setClearScreenshot(false)
      await loadBlueprints()
    } catch (err: any) {
      setCreateError(err.message || 'Could not create blueprint.')
    } finally {
      setCreating(false)
    }
  }

  const saveBlueprintEdits = async () => {
    if (!editingBlueprint || bindingsLoading) return
    setCreating(true)
    setCreateError(null)
    try {
      await Promise.all(
        bindings.map((b) => gadget.setBlueprintAnnotation(b.bindingName, b.annotation)),
      )

      const screenshot: BlueprintScreenshotUpload | null | undefined = clearScreenshot
        ? null
        : newScreenshotBlob
          ? {
            mimeType: 'image/jpeg',
            content: new Uint8Array(await newScreenshotBlob.arrayBuffer()),
          }
          : undefined

      await overseer.updateBlueprint(editingBlueprint.id, {
        title: newTitle.trim() || editingBlueprint.title,
        description: newDescription.trim(),
        updateBindings: true,
        screenshot,
      })
      toasts.add({ title: 'Blueprint updated.', type: 'success' })
      setFormMode('list')
      setEditingBlueprint(null)
      setNewScreenshotBlob(null)
      setNewScreenshotUrl(null)
      setClearScreenshot(false)
      await loadBlueprints()
    } catch (err: any) {
      setCreateError(err.message || 'Could not update blueprint.')
    } finally {
      setCreating(false)
    }
  }

  const deleteBlueprint = async (id: string) => {
    setDeletingId(id)
    try {
      await overseer.deleteBlueprint(id)
      toasts.add({ title: 'Blueprint deleted.', type: 'success' })
      setConfirmingDeleteId(null)
      await loadBlueprints()
    } catch (err: any) {
      toasts.add({ title: err.message || 'Failed to delete blueprint.', type: 'error' })
    } finally {
      setDeletingId(null)
    }
  }

  const savedScreenshotUrl = formMode === 'edit' && editingBlueprint?.screenshotUrl && !clearScreenshot
    ? editingBlueprint.screenshotUrl
    : null
  const screenshotPreviewUrl = newScreenshotUrl ?? savedScreenshotUrl

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="!z-[1000] !w-[min(640px,calc(100vw-32px))] overflow-hidden bg-background p-0 !top-[10%] !-translate-y-0" size="lg">
          <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-5 sm:px-6">
            <div className="flex min-w-0 items-start gap-3">
              <div className="min-w-0">
              <DialogTitle className="text-[17px] leading-6 font-medium tracking-[-0.35px] text-foreground">
                {formMode === 'create' ? 'Create blueprint' : formMode === 'edit' ? 'Edit blueprint' : 'Blueprints'}
              </DialogTitle>
              <DialogDescription className="mt-1 text-[13px] leading-[18px] font-normal tracking-[-0.25px] text-muted-foreground">
                {formMode === 'create'
                  ? 'Describe what people get when they start from this blueprint.'
                  : formMode === 'edit'
                    ? 'Update the details, screenshot, and connection guidance for this blueprint.'
                    : 'Turn this gadget into a reusable starting point.'}
              </DialogDescription>
              </div>
            </div>
            <DialogClose
              render={(props) => (
                <Button
                  {...props}
                  aria-label="Close"
                 className="!flex !h-8 !w-8 shrink-0 cursor-pointer items-center justify-center rounded-md !p-0 transition-[background-color,color,opacity,transform] duration-150 ease-out active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100" variant="ghost" size="icon-sm">
                  <X size={18} />
                </Button>
              )}
            />
          </div>

          <div
            className={formMode !== 'list' ? 'flex flex-col' : ''}
            style={formMode !== 'list' ? { maxHeight: 'calc(80vh - 80px)' } : undefined}
          >
            {formMode !== 'list' ? (
              <>
                <div className="flex-1 overflow-y-auto chat-panel space-y-5 px-4 py-5 sm:px-6">
                  <div className="space-y-3">
                    <Input
                      placeholder="Title"
                      aria-label="Blueprint title"
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      className="!h-9 rounded-lg border border-border bg-background px-3 text-[13px] leading-[18px] font-normal tracking-[-0.25px] text-foreground placeholder:text-muted-foreground shadow-none focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring/15 w-full"
                    />
                    <Textarea
                      placeholder="Description (optional)"
                      aria-label="Blueprint description"
                      value={newDescription}
                      onChange={(e) => setNewDescription(e.target.value)}
                      rows={3}
                      className="rounded-lg border border-border bg-background px-3 py-2 text-[13px] leading-[18px] font-normal tracking-[-0.25px] text-foreground placeholder:text-muted-foreground shadow-none focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring/15 w-full"
                    />
                    <input
                      ref={screenshotInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleScreenshotSelected}
                    />
                    <div className="rounded-xl border border-border bg-background p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="m-0 text-[13px] leading-[18px] font-medium tracking-[-0.25px] text-foreground">
                            Screenshot
                          </p>
                          <p className="m-0 mt-0.5 text-[12px] leading-4 font-normal tracking-[-0.2px] text-muted-foreground">
                            Optional image shown on Explore and the blueprint detail page.
                            {formMode === 'edit' && !newScreenshotUrl && editingBlueprint?.screenshotUrl && !clearScreenshot ? ' The current screenshot will stay unless you upload a new one.' : ''}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {(newScreenshotUrl || (formMode === 'edit' && editingBlueprint?.screenshotUrl && !clearScreenshot)) && (
                            <Button
                              className="inline-flex cursor-pointer items-center justify-center rounded-lg text-[13px] leading-[18px] font-medium tracking-[-0.25px] transition-[background-color,color,opacity,transform] duration-150 ease-out active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 !h-8 border border-border bg-background px-3 text-foreground enabled:hover:bg-card disabled:opacity-40 !h-8"
                              onClick={() => {
                                setNewScreenshotBlob(null)
                                setNewScreenshotUrl(prev => {
                                  if (prev) URL.revokeObjectURL(prev)
                                  return null
                                })
                                setClearScreenshot(true)
                              }}
                              disabled={processingScreenshot || creating}
                             variant="secondary">
                              Clear
                            </Button>
                          )}
                          <Button
                            className="inline-flex cursor-pointer items-center justify-center rounded-lg text-[13px] leading-[18px] font-medium tracking-[-0.25px] transition-[background-color,color,opacity,transform] duration-150 ease-out active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 !h-8 border border-border bg-background px-3 text-foreground enabled:hover:bg-card disabled:opacity-40 !h-8"
                            onClick={() => screenshotInputRef.current?.click()}
                            disabled={processingScreenshot || creating}
                           variant="secondary">
                            <ImageSquare size={13} weight="bold" />
                            {processingScreenshot ? 'Processing...' : newScreenshotUrl || (formMode === 'edit' && editingBlueprint?.screenshotUrl && !clearScreenshot) ? 'Change' : 'Upload'}
                          </Button>
                        </div>
                      </div>
                      {screenshotPreviewUrl && (
                        <div className="mt-3 overflow-hidden rounded-lg border border-border bg-muted">
                          <img
                            src={screenshotPreviewUrl}
                            alt="Blueprint screenshot preview"
                            className="max-h-[320px] w-full object-contain"
                          />
                        </div>
                      )}
                      {clearScreenshot && !newScreenshotUrl && (
                        <div className="mt-3 rounded-lg border border-dashed border-border bg-muted px-3 py-2 text-[12px] leading-4 text-muted-foreground">
                          Screenshot will be removed when you save.
                        </div>
                      )}
                    </div>
                  </div>

                  {bindingsLoading ? (
                    <div className="rounded-xl border border-border bg-background px-4 py-6 text-center text-[13px] text-muted-foreground">
                      Loading connections...
                    </div>
                  ) : bindingsError ? (
                    <div className="rounded-xl border border-border bg-background px-4 py-3 text-[13px] text-muted-foreground">
                      {bindingsError}
                    </div>
                  ) : bindings.length > 0 ? (
                    <section>
                      <h3 className="m-0 mb-1 text-[13px] leading-[18px] font-medium tracking-[-0.25px] text-foreground">
                        Connections
                      </h3>
                      <p className="m-0 mb-3 text-[12px] leading-4 font-normal tracking-[-0.2px] text-muted-foreground">
                        Name each connection and add guidance for people using this blueprint.
                      </p>
                      <div className="space-y-2">
                        {bindings.map((b) => (
                          <BlueprintBindingCard
                            key={b.bindingName}
                            data={b}
                            onChange={(annotation) => updateBindingAnnotation(b.bindingName, annotation)}
                          />
                        ))}
                      </div>
                    </section>
                  ) : null}
                </div>

                <div className="border-t border-border px-4 py-4 sm:px-6">
                  {createError && (
                    <div className="mb-3 flex items-start gap-2 rounded-lg border border-l-2 border-l-primary border-y-border border-r-border bg-background px-3 py-2 text-[12px] leading-[18px] font-normal tracking-[-0.2px] text-foreground">
                      <Warning size={14} weight="fill" className="mt-0.5 shrink-0 text-primary" />
                      <span>{createError}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <Button
                      className="inline-flex cursor-pointer items-center justify-center rounded-lg text-[13px] leading-[18px] font-medium tracking-[-0.25px] transition-[background-color,color,opacity,transform] duration-150 ease-out active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 !h-8 border border-border bg-background px-3 text-foreground enabled:hover:bg-card disabled:opacity-40 !h-9 min-w-[64px]"
                      onClick={() => {
                        setFormMode('list')
                        setEditingBlueprint(null)
                      }}
                      disabled={creating}
                     variant="secondary">
                      Back
                    </Button>
                    <Button

                      className="inline-flex cursor-pointer items-center justify-center rounded-lg text-[13px] leading-[18px] font-medium tracking-[-0.25px] transition-[background-color,color,opacity,transform] duration-150 ease-out active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 !h-9 bg-foreground px-3 text-primary-foreground enabled:hover:bg-foreground disabled:opacity-50 min-w-[64px]"
                      onClick={formMode === 'create' ? createBlueprint : saveBlueprintEdits}
                      disabled={creating || bindingsLoading || processingScreenshot}
                     variant="primary">
                      {creating
                        ? formMode === 'create' ? 'Creating...' : 'Saving...'
                        : processingScreenshot ? 'Processing...'
                          : bindingsLoading ? 'Loading...'
                            : formMode === 'create' ? 'Create' : 'Save'}
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="space-y-4 px-4 py-5 sm:px-6">
              <button
                type="button"
                onClick={() => {
                  setNewTitle(metadata.title)
                  setNewDescription('')
                  setNewScreenshotBlob(null)
                  setNewScreenshotUrl(null)
                  setClearScreenshot(false)
                  setEditingBlueprint(null)
                  setFormMode('create')
                }}
                className="flex w-full items-center justify-between rounded-xl border border-border bg-background px-4 py-3 text-left transition-colors hover:bg-card"
              >
                <span>
                  <span className="block text-[13px] leading-[18px] font-medium tracking-[-0.25px] text-foreground">
                    Create blueprint
                  </span>
                  <span className="mt-0.5 block text-[13px] leading-[18px] font-normal tracking-[-0.25px] text-muted-foreground">
                    Publish this gadget as a reusable template.
                  </span>
                </span>
                <Plus size={16} className="text-muted-foreground" />
              </button>

            <section>
              <h3 className="mb-2 text-[13px] leading-[18px] font-medium tracking-[-0.25px] text-foreground">
                Existing blueprints
              </h3>

              {loading ? (
                <div className="rounded-xl border border-border bg-background px-4 py-6 text-center text-[13px] text-muted-foreground">
                  Loading blueprints...
                </div>
              ) : blueprints.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-background px-4 py-6 text-center">
                  <p className="text-[13px] leading-[18px] font-normal tracking-[-0.25px] text-muted-foreground">
                    No blueprints yet.
                  </p>
                </div>
              ) : (
                <div className="overflow-hidden rounded-xl border border-border bg-background">
                  {blueprints.map((bp, index) => (
                    <BlueprintRow
                      key={bp.id}
                      bp={bp}
                      isFirst={index === 0}
                      onStartEdit={() => {
                        setNewTitle(bp.title)
                        setNewDescription(bp.description)
                        setNewScreenshotBlob(null)
                        setNewScreenshotUrl(null)
                        setClearScreenshot(false)
                        setEditingBlueprint(bp)
                        setFormMode('edit')
                      }}
                      onUpdateCode={async () => {
                        try {
                          await overseer.updateBlueprint(bp.id, { updateCode: true })
                          toasts.add({ title: 'Blueprint updated to current code.', type: 'success' })
                          loadBlueprints()
                        } catch (err: any) {
                          toasts.add({ title: err.message || 'Failed to update blueprint.', type: 'error' })
                        }
                      }}
                      onRetryPublish={async () => {
                        try {
                          await overseer.retryBlueprintPublish(bp.id)
                          toasts.add({ title: 'Blueprint published successfully.', type: 'success' })
                          loadBlueprints()
                        } catch (err: any) {
                          toasts.add({ title: err.message || 'Retry failed.', type: 'error' })
                        }
                      }}
                      onCopyLink={async () => {
                        const url = `${window.location.origin}/blueprint/${bp.id}`
                        return copyToClipboard(url)
                      }}
                      isConfirmingDelete={confirmingDeleteId === bp.id}
                      isDeleting={deletingId === bp.id}
                      onStartDelete={() => setConfirmingDeleteId(bp.id)}
                      onConfirmDelete={() => deleteBlueprint(bp.id)}
                      onCancelDelete={() => setConfirmingDeleteId(null)}
                    />
                  ))}
                </div>
              )}
            </section>
              </div>
            )}
          </div>
      </DialogContent>
    </Dialog>
  )
}

function BlueprintRow({
  bp,
  isFirst,
  onStartEdit,
  onUpdateCode,
  onRetryPublish,
  onCopyLink,
  isConfirmingDelete,
  isDeleting,
  onStartDelete,
  onConfirmDelete,
  onCancelDelete,
}: {
  bp: BlueprintGadgetSummary
  isFirst: boolean
  onStartEdit: () => void
  onUpdateCode: () => void
  onRetryPublish: () => void
  onCopyLink: () => Promise<boolean>
  isConfirmingDelete: boolean
  isDeleting: boolean
  onStartDelete: () => void
  onConfirmDelete: () => void
  onCancelDelete: () => void
}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  useEffect(() => {
    if (copyState === 'idle') return
    const t = setTimeout(() => setCopyState('idle'), 1500)
    return () => clearTimeout(t)
  }, [copyState])

  const ROW_MIN_H = 'min-h-[116px]'
  if (isConfirmingDelete) {
    return (
      <div
        className={`flex items-center px-4 py-4 ${ROW_MIN_H} ${isFirst ? '' : 'border-t border-border'} bg-destructive-muted/40`}
      >
        <div className="flex w-full flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="m-0 truncate text-[14px] leading-5 font-semibold tracking-[-0.3px] text-destructive">
              Delete "{bp.title}"?
            </p>
            <p className="m-0 mt-0.5 text-[12px] leading-4 font-normal tracking-[-0.2px] text-muted-foreground">
              People who started a gadget from this blueprint won't be affected, but the link will stop working.
            </p>
          </div>
          <button
            type="button"
            onClick={onConfirmDelete}
            disabled={isDeleting}
            className="inline-flex h-7 shrink-0 cursor-pointer items-center rounded-md bg-destructive px-2.5 text-[12px] leading-4 font-medium tracking-[-0.2px] text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </button>
          <button
            type="button"
            onClick={onCancelDelete}
            disabled={isDeleting}
            className="inline-flex h-7 shrink-0 cursor-pointer items-center rounded-md bg-transparent px-2.5 text-[12px] leading-4 font-medium tracking-[-0.2px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`group/row relative px-4 py-4 ${ROW_MIN_H} ${isFirst ? '' : 'border-t border-border'}`}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <p className="m-0 min-w-0 flex-1 truncate text-[15px] leading-5 font-semibold tracking-[-0.3px] text-foreground">
          {bp.title}
        </p>

        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] leading-4 font-semibold tracking-[-0.1px] ${
            bp.dirty
              ? 'border-primary/25 bg-primary/10 text-primary'
              : 'border-border bg-muted text-muted-foreground'
          }`}
          title={bp.dirty ? 'Last publish failed' : undefined}
        >
          {bp.dirty && (
            <span
              className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
              aria-hidden="true"
            />
          )}
          v{bp.version} · {new Date(bp.codeVersionDate).toLocaleDateString()}
        </span>
      </div>

      <div className="mt-1.5 min-h-[18px]">
        {bp.description ? (
          <p className="m-0 text-[13px] leading-[18px] font-normal tracking-[-0.25px] text-muted-foreground whitespace-pre-wrap">
            {bp.description}
          </p>
        ) : (
          <p className="m-0 text-[13px] leading-[18px] font-normal tracking-[-0.25px] text-muted-foreground">
            No description
          </p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="-ml-[7px] flex flex-wrap items-center gap-1">
          <GhostButton onClick={onUpdateCode} icon={<ArrowsClockwise size={13} />}>
            Update code
          </GhostButton>
          {bp.dirty && (
            <GhostButton onClick={onRetryPublish} icon={<ArrowsClockwise size={13} />}>
              Retry publish
            </GhostButton>
          )}
          <GhostButton
            onClick={async () => {
              setCopyState(await onCopyLink() ? 'copied' : 'failed')
            }}
            icon={
              copyState === 'copied' ? (
                <Check size={13} className="text-status-success" />
              ) : (
                <Copy size={13} />
              )
            }
          >
            {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy link'}
          </GhostButton>
        </div>
        <div className="-mr-1.5 ml-auto flex items-center gap-0.5 opacity-60 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            onClick={onStartEdit}
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md bg-transparent text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Edit blueprint"
          >
            <Pencil size={13} />
          </button>
          <button
            type="button"
            onClick={onStartDelete}
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md bg-transparent text-muted-foreground transition-colors hover:bg-destructive-muted hover:text-destructive"
            aria-label="Delete blueprint"
          >
            <Trash size={13} />
          </button>
        </div>
      </div>
    </div>
  )
}

function GhostButton({
  onClick,
  icon,
  children,
}: {
  onClick: () => void | Promise<void>
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md bg-transparent px-2 text-[12px] leading-4 font-medium tracking-[-0.2px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {icon}
      {children}
    </button>
  )
}
