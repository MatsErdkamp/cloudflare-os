import {useState } from 'react'
import { DownloadSimple } from '@phosphor-icons/react'
import type { RpcStub } from 'capnweb'
import type { GadgetClient } from '@gadgets/workshop-shared/api'
import { makeExportFilename, saveStreamToFile } from './fileTransfers'
import { Tooltip, useToast, TooltipContent, TooltipTrigger, Button } from '@matser/ui'
type Props = {
  gadget: RpcStub<GadgetClient> | null
  gadgetTitle: string
  chatId?: number
  disabled?: boolean
}

export default function GadgetExportMenu({ gadget, gadgetTitle, chatId, disabled }: Props) {
  const [exporting, setExporting] = useState(false)
  const toasts = useToast()

  const download = async () => {
    if (!gadget || exporting) return

    setExporting(true)
    try {
      await saveStreamToFile(
        () => gadget.exportPdf(chatId),
        makeExportFilename(gadgetTitle, '.pdf'),
        {
          description: 'PDF document',
          contentType: 'application/pdf',
          extension: '.pdf',
        },
      )
    } catch (error) {
      console.error('Failed to export Gadget as PDF:', error)
      toasts.add({ title: 'Failed to export PDF', type: 'error' })
    } finally {
      setExporting(false)
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger render={<span className="relative inline-flex">
        <Button
          aria-label="Export to PDF"
          disabled={disabled || !gadget || exporting}
          onClick={() => { void download() }}
         className="!flex !h-8 !w-8 shrink-0 cursor-pointer items-center justify-center rounded-md !p-0 transition-[background-color,color,opacity,transform] duration-150 ease-out active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100" variant="ghost" size="icon-sm">
          <DownloadSimple size={17} />
        </Button>
        {exporting && (
          <span className="pointer-events-none absolute bottom-0 left-1 right-1 h-0.5 overflow-hidden rounded-full bg-accent">
            <span className="absolute inset-y-0 w-1/3 bg-primary animate-[thinking_1.5s_ease-in-out_infinite]" />
          </span>
        )}
      </span>} />
      <TooltipContent>{exporting ? 'Exporting to PDF' : 'Export to PDF'}</TooltipContent>
    </Tooltip>
  )
}
