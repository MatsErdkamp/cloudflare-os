import {X } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose, Button } from '@matser/ui'
interface DeleteConfirmationDialogProps {
  open: boolean
  title: string
  description: ReactNode
  isDeleting?: boolean
  /** Label for the confirm button (defaults to "Delete"). */
  confirmLabel?: string
  /** Label for the confirm button while the action runs (defaults to "Deleting..."). */
  confirmingLabel?: string
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

export default function DeleteConfirmationDialog({
  open,
  title,
  description,
  isDeleting = false,
  confirmLabel = 'Delete',
  confirmingLabel = 'Deleting...',
  onOpenChange,
  onConfirm,
}: DeleteConfirmationDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isDeleting) onOpenChange(nextOpen)
      }}
    >
      <DialogContent
        className="!z-[1000] !w-[min(420px,calc(100vw-32px))] overflow-hidden bg-background p-0 !top-[20%] !-translate-y-0"
        size="sm"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <DialogTitle className="text-[15px] leading-5 font-medium tracking-[-0.3px] text-foreground">
              {title}
            </DialogTitle>
            <DialogDescription className="mt-1 text-[12px] leading-4 font-normal tracking-[-0.2px] text-muted-foreground">
              {description}
            </DialogDescription>
          </div>
          <DialogClose
            render={(props) => (
              <Button
                {...props}
                className="!flex !h-8 !w-8 shrink-0 cursor-pointer items-center justify-center rounded-md !p-0 transition-[background-color,color,opacity,transform] duration-150 ease-out active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 !h-7 !w-7"
                disabled={isDeleting}
                aria-label="Close"
               variant="ghost" size="icon-sm">
                <X size={16} />
              </Button>
            )}
          />
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border bg-background px-5 py-3">
          <DialogClose
            render={(props) => (
              <Button
                {...props}
                className="inline-flex cursor-pointer items-center justify-center rounded-lg text-[13px] leading-[18px] font-medium tracking-[-0.25px] transition-[background-color,color,opacity,transform] duration-150 ease-out active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 !h-8 border border-border bg-background px-3 text-foreground enabled:hover:bg-card disabled:opacity-40 !h-9"
                disabled={isDeleting}
               variant="secondary">
                Cancel
              </Button>
            )}
          />
          <Button

            onClick={onConfirm}
            disabled={isDeleting}
            className="inline-flex cursor-pointer items-center justify-center rounded-lg text-[13px] leading-[18px] font-medium tracking-[-0.25px] transition-[background-color,color,opacity,transform] duration-150 ease-out active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 !h-8 bg-destructive px-3 text-white enabled:hover:opacity-90 disabled:opacity-50 !h-9 min-w-[64px]"
           variant="destructive">
            {isDeleting ? confirmingLabel : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
