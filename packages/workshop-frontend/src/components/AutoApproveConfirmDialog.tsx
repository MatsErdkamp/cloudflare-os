import {X } from '@phosphor-icons/react'
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose, Button } from '@matser/ui'
interface AutoApproveConfirmDialogProps {
  open: boolean
  // Human-readable label of the action kind, e.g. "Append to Google Doc".
  actionLabel: string
  // Title of the connection (gatekeeper) the rule applies to, e.g. "My Google Doc".
  resourceTitle: string
  isProcessing?: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

// Confirmation for enabling auto-approval of an action type on a connection. Enabling is a standing
// policy change -- it removes human review for a whole class of future actions
export default function AutoApproveConfirmDialog({
  open,
  actionLabel,
  resourceTitle,
  isProcessing = false,
  onOpenChange,
  onConfirm,
}: AutoApproveConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isProcessing) onOpenChange(nextOpen)
      }}
    >
      <DialogContent
        className="!z-[1000] !w-[min(440px,calc(100vw-32px))] overflow-hidden bg-background p-0 !top-[20%] !-translate-y-0"
        size="sm"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <DialogTitle className="text-[15px] leading-5 font-medium tracking-[-0.3px] text-foreground">
              Always approve “{actionLabel}”?
            </DialogTitle>
            <DialogDescription className="mt-1 text-[12px] leading-4 font-normal tracking-[-0.2px] text-muted-foreground">
              Future <span className="font-medium text-foreground">{actionLabel}</span> actions on{' '}
              <span className="font-medium text-foreground">{resourceTitle}</span> will be applied
              automatically, without asking for approval. This action will be applied now too.
            </DialogDescription>
          </div>
          <DialogClose
            render={(props) => (
              <Button
                {...props}
                className="!flex !h-8 !w-8 shrink-0 cursor-pointer items-center justify-center rounded-md !p-0 transition-[background-color,color,opacity,transform] duration-150 ease-out active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 !h-7 !w-7"
                disabled={isProcessing}
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
              <Button {...props} className="inline-flex cursor-pointer items-center justify-center rounded-lg text-[13px] leading-[18px] font-medium tracking-[-0.25px] transition-[background-color,color,opacity,transform] duration-150 ease-out active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 !h-8 border border-border bg-background px-3 text-foreground enabled:hover:bg-card disabled:opacity-40 !h-9" disabled={isProcessing} variant="secondary">
                Cancel
              </Button>
            )}
          />
          <Button

            onClick={onConfirm}
            disabled={isProcessing}
            className="inline-flex cursor-pointer items-center justify-center rounded-lg text-[13px] leading-[18px] font-medium tracking-[-0.25px] transition-[background-color,color,opacity,transform] duration-150 ease-out active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 !h-9 bg-foreground px-3 text-primary-foreground enabled:hover:bg-foreground disabled:opacity-50 !h-9 min-w-[64px]"
           variant="primary">
            {isProcessing ? 'Enabling...' : 'Always approve'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
