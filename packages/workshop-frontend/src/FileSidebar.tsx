import {useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { DotsThree, DownloadSimple, Pencil, Plus, Trash, X } from '@phosphor-icons/react'
import DeleteConfirmationDialog from './components/DeleteConfirmationDialog'
import { Dialog, DropdownMenu, useToast, DialogContent, DialogTitle, DialogDescription, DialogClose, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, Button, Input} from '@matser/ui'
interface FileSidebarProps {
  files: string[]
  activeFile: string | null
  streamingActiveFile?: string | null
  dirtyFiles: Set<string>
  changedFiles?: Set<string>  // Files with proposed changes (for diff mode)
  fileChangeStatuses?: Map<string, FileChangeStatus>
  isDiffMode?: boolean         // Whether we're in diff mode
  editLocked?: boolean
  onFileSelect: (filename: string) => void
  onFileCreate: (filename: string) => void
  onFileDelete: (filename: string) => void
  onFileRename: (oldName: string, newName: string) => void
  onFileDownload: (filename: string) => void
  ref?: Ref<FileSidebarHandle>
}

export type FileChangeStatus = 'added' | 'deleted' | 'modified' | 'unchanged'

export interface FileSidebarHandle {
  openCreateModal: () => void
}

export default function FileSidebar({
  files,
  activeFile,
  streamingActiveFile,
  dirtyFiles,
  changedFiles,
  fileChangeStatuses,
  isDiffMode = false,
  editLocked = false,
  onFileSelect,
  onFileCreate,
  onFileDelete,
  onFileRename,
  onFileDownload,
  ref,
}: FileSidebarProps) {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [deletingFile, setDeletingFile] = useState<string | null>(null)
  const [newFileName, setNewFileName] = useState('')
  const [renamingFile, setRenamingFile] = useState<string | null>(null)
  const createInputRef = useRef<HTMLInputElement | null>(null)

  useImperativeHandle(ref, () => ({
    openCreateModal: () => setIsCreateModalOpen(true),
  }), [])

  const toasts = useToast()

  const handleCreateFile = () => {
    if (!newFileName.trim()) {
      toasts.add({ title: 'Filename cannot be empty', type: 'error' })
      return
    }

    if (files.includes(newFileName.trim())) {
      toasts.add({ title: 'A file with this name already exists', type: 'error' })
      return
    }

    onFileCreate(newFileName.trim())
    setNewFileName('')
    setIsCreateModalOpen(false)
  }

  const startRename = (filename: string) => {
    setRenamingFile(filename)
  }

  const cancelRename = () => {
    setRenamingFile(null)
  }

  const commitRename = (filename: string, nextName: string) => {
    const trimmed = nextName.trim()
    if (!trimmed || trimmed === filename) {
      setRenamingFile(null)
      return
    }

    if (files.includes(trimmed)) {
      toasts.add({ title: 'A file with this name already exists', type: 'error' })
      return
    }

    onFileRename(filename, trimmed)
    setRenamingFile(null)
  }

  const startDelete = (filename: string) => {
    if (files.length <= 1) {
      toasts.add({ title: 'Cannot delete the last remaining file', type: 'error' })
      return
    }
    setDeletingFile(filename)
    setIsDeleteModalOpen(true)
  }

  const confirmDelete = () => {
    if (deletingFile) {
      onFileDelete(deletingFile)
    }
    setDeletingFile(null)
    setIsDeleteModalOpen(false)
  }

  return (
    <div className="flex h-full w-[244px] flex-col border-r border-border bg-background">
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 px-3 pt-3 pb-2">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          Files
        </span>
        <Button
          onClick={() => setIsCreateModalOpen(true)}
          disabled={editLocked}
          aria-label="New file"
          title="New file"
          className="!flex !h-8 !w-8 shrink-0 cursor-pointer items-center justify-center rounded-md !p-0 transition-[background-color,color,opacity,transform] duration-150 ease-out active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 !h-6 !w-6 text-muted-foreground hover:bg-muted hover:text-foreground"
         variant="ghost" size="icon-sm">
          <Plus size={14} weight="bold" />
        </Button>
      </div>

      <div className="flex-1 overflow-auto px-2 pb-3">
        {files.map(filename => {
          const isDirty = dirtyFiles.has(filename)
          const changeStatus = fileChangeStatuses?.get(filename)
          const hasChanges = changeStatus
            ? changeStatus !== 'unchanged'
            : changedFiles?.has(filename) || false
          const isUnchanged = isDiffMode && !hasChanges
          const isActive = activeFile === filename
          const isStreamingActive = streamingActiveFile === filename
          const dotClass = getStatusDotClass(changeStatus, isDirty)

          return (
            <FileRow
              key={filename}
              filename={filename}
              isActive={isActive}
              isUnchanged={isUnchanged}
              isStreamingActive={isStreamingActive}
              changeStatus={changeStatus}
              dotClass={dotClass}
              showDot={!!changeStatus || !!isDirty}
              editLocked={editLocked}
              isRenaming={renamingFile === filename}
              onSelect={() => onFileSelect(filename)}
              onRename={() => {
                startRename(filename)
              }}
              onDelete={() => {
                startDelete(filename)
              }}
              onDownload={() => onFileDownload(filename)}
              onRenameSubmit={(nextName) => commitRename(filename, nextName)}
              onRenameCancel={cancelRename}
            />
          )
        })}
      </div>

      <Dialog
        open={isCreateModalOpen}
        onOpenChange={(o) => {
          if (!o) {
            setIsCreateModalOpen(false)
            setNewFileName('')
          }
        }}
      >
        <DialogContent
          className="!z-[1000] !w-[min(420px,calc(100vw-32px))] overflow-hidden bg-background p-0 !top-[18%] !-translate-y-0"
          size="sm"
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div className="min-w-0">
              <DialogTitle className="text-[15px] leading-5 font-medium tracking-[-0.3px] text-foreground">
                New file
              </DialogTitle>
              <DialogDescription className="mt-1 text-[12px] leading-4 font-normal tracking-[-0.2px] text-muted-foreground">
                Create a new file in this gadget.
              </DialogDescription>
            </div>
            <DialogClose
              render={(props) => (
                <Button
                  {...props}
                  className="!flex !h-8 !w-8 shrink-0 cursor-pointer items-center justify-center rounded-md !p-0 transition-[background-color,color,opacity,transform] duration-150 ease-out active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 !h-7 !w-7"
                  aria-label="Close"
                 variant="ghost" size="icon-sm">
                  <X size={16} />
                </Button>
              )}
            />
          </div>

          <div className="px-5 py-4">
            <Input
              ref={createInputRef}
              autoFocus
              placeholder="filename.ts"
              aria-label="Filename"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleCreateFile()
                }
              }}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className="!h-9 rounded-lg border border-border bg-background px-3 text-[13px] leading-[18px] font-normal tracking-[-0.25px] text-foreground placeholder:text-muted-foreground shadow-none focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring/15 w-full font-mono"
            />
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border bg-background px-5 py-3">
            <DialogClose
              render={(props) => (
                <Button
                  {...props}
                  className="inline-flex cursor-pointer items-center justify-center rounded-lg text-[13px] leading-[18px] font-medium tracking-[-0.25px] transition-[background-color,color,opacity,transform] duration-150 ease-out active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 !h-8 border border-border bg-background px-3 text-foreground enabled:hover:bg-card disabled:opacity-40 !h-9"
                 variant="secondary">
                  Cancel
                </Button>
              )}
            />
            <Button

              onClick={handleCreateFile}
              disabled={!newFileName.trim()}
             className="inline-flex cursor-pointer items-center justify-center rounded-lg text-[13px] leading-[18px] font-medium tracking-[-0.25px] transition-[background-color,color,opacity,transform] duration-150 ease-out active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 !h-9 bg-foreground px-3 text-primary-foreground enabled:hover:bg-foreground disabled:opacity-50" variant="primary">
              Create file
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <DeleteConfirmationDialog
        open={isDeleteModalOpen}
        onOpenChange={(o) => {
          if (!o) {
            setIsDeleteModalOpen(false)
            setDeletingFile(null)
          }
        }}
        title="Delete file?"
        description={<>This removes <span className="font-mono text-foreground">{deletingFile}</span> from the gadget. You can&apos;t undo this.</>}
        onConfirm={confirmDelete}
      />
    </div>
  )
}

interface FileRowProps {
  filename: string
  isActive: boolean
  isUnchanged: boolean
  isStreamingActive: boolean
  changeStatus?: FileChangeStatus
  dotClass: string | null
  showDot: boolean
  editLocked: boolean
  isRenaming: boolean
  onSelect: () => void
  onRename: () => void
  onDelete: () => void
  onDownload: () => void
  onRenameSubmit: (nextName: string) => void
  onRenameCancel: () => void
}

function FileRow({
  filename,
  isActive,
  isUnchanged,
  isStreamingActive,
  changeStatus,
  dotClass,
  showDot,
  editLocked,
  isRenaming,
  onSelect,
  onRename,
  onDelete,
  onDownload,
  onRenameSubmit,
  onRenameCancel,
}: FileRowProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [renameValue, setRenameValue] = useState(filename)
  const isDeleted = changeStatus === 'deleted'

  useEffect(() => {
    if (!isRenaming) return
    setRenameValue(filename)
    const id = window.setTimeout(() => {
      const input = inputRef.current
      if (!input) return
      input.focus()
      const dotIndex = filename.lastIndexOf('.')
      if (dotIndex > 0) {
        input.setSelectionRange(0, dotIndex)
      } else {
        input.select()
      }
    }, 0)
    return () => window.clearTimeout(id)
  }, [isRenaming, filename])

  return (
    <div
      className={[
        'group relative mb-[2px] flex h-7 items-center gap-2 rounded-md px-2 text-[13px] leading-[18px] tracking-[-0.2px] transition-[background-color,box-shadow,color,opacity] duration-150 ease-out',
        isRenaming
          ? 'bg-background ring-1 ring-ring/40'
          : isActive
            ? 'file-row-active cursor-pointer bg-muted text-foreground font-medium'
            : 'cursor-pointer text-foreground hover:bg-muted',
        isUnchanged && !isRenaming ? 'opacity-50' : '',
      ].join(' ')}
      onClick={isRenaming ? undefined : onSelect}
    >
      <span
        aria-hidden="true"
        className={[
          'h-1.5 w-1.5 shrink-0 rounded-full',
          showDot && dotClass ? dotClass : 'bg-transparent',
        ].join(' ')}
      />

      {isRenaming ? (
        <input
          ref={inputRef}
          value={renameValue}
          onChange={(event) => setRenameValue(event.target.value)}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              onRenameSubmit(renameValue)
            } else if (event.key === 'Escape') {
              event.preventDefault()
              onRenameCancel()
            }
          }}
          onBlur={() => {
            if (renameValue.trim() === '' || renameValue.trim() === filename) {
              onRenameCancel()
            } else {
              onRenameSubmit(renameValue)
            }
          }}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-label={`Rename ${filename}`}
          className="min-w-0 flex-1 bg-transparent text-[13px] leading-[18px] tracking-[-0.2px] text-foreground outline-none placeholder:text-muted-foreground"
        />
      ) : (
        <button
          type="button"
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 self-stretch bg-transparent p-0 text-left text-[13px] leading-[18px] tracking-[-0.2px] text-inherit outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
          aria-current={isActive ? 'page' : undefined}
          onClick={(event) => {
            event.stopPropagation()
            onSelect()
          }}
        >
          <span className="min-w-0 flex-1 truncate">{filename}</span>
          {isStreamingActive && (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-status-success"
              aria-label={`${filename} is being edited`}
              title="Agent is editing this file"
            />
          )}
        </button>
      )}

      {!isRenaming && !isDeleted && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={(
              <Button
                aria-label={`Actions for ${filename}`}
                onClick={(event) => event.stopPropagation()}
                className="!flex !h-8 !w-8 shrink-0 cursor-pointer items-center justify-center rounded-md !p-0 transition-[background-color,color,opacity,transform] duration-150 ease-out active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 !h-5 !w-5 text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 data-[popup-open]:opacity-100"
               variant="ghost" size="icon-sm">
                <DotsThree size={14} weight="bold" />
              </Button>
            )}
          />
          <DropdownMenuContent
            onClick={(event) => event.stopPropagation()}
            className="themed-floating-shadow !z-[1100] !min-w-[144px] rounded-lg border border-border bg-background p-1"
          >
            <DropdownMenuItem
              onClick={onDownload}
              className="!h-auto rounded-md !px-2.5 !py-1.5 text-[12px] leading-4 tracking-[-0.2px] text-foreground transition-colors data-highlighted:bg-muted"
            >
              <DownloadSimple size={12} className="mr-2" />Download
            </DropdownMenuItem>
            {!editLocked && (
              <>
                <DropdownMenuItem
                  onClick={onRename}
                  className="!h-auto rounded-md !px-2.5 !py-1.5 text-[12px] leading-4 tracking-[-0.2px] text-foreground transition-colors data-highlighted:bg-muted"
                >
                  <Pencil size={12} className="mr-2" />Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={onDelete}
                  className="!h-auto rounded-md !px-2.5 !py-1.5 text-[12px] leading-4 tracking-[-0.2px] transition-colors data-highlighted:bg-destructive-muted"
                >
                  <Trash size={12} className="mr-2" />Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

function getStatusDotClass(status: FileChangeStatus | undefined, isDirty: boolean): string | null {
  if (isDirty) return 'bg-destructive'
  if (status === 'added') return 'bg-status-success'
  if (status === 'deleted') return 'bg-destructive'
  if (status === 'modified') return 'bg-status-warning'
  if (status === 'unchanged') return null
  return null
}
