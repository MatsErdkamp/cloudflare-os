import { Link } from '@tanstack/react-router'
import { MENU_CONTENT, MENU_ITEM, MENU_ITEM_DANGER, MENU_POSITIONER_STYLE } from '../menuStyles'
import { useState, useEffect, useRef } from 'react'
import type { GadgetMetadataWithTimestamps } from '@gadgets/workshop-shared/api'
import { Button, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, Icons, Input } from '@matser/ui'
function initials(title: string | undefined): string {
  const t = (title || 'Untitled').trim()
  if (!t) return 'UG'
  const parts = t.split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || t.slice(0, 2).toUpperCase()
}

// One row in the sidebar's Favorites / Recent list. Compact, with a monogram avatar, a truncated
// title, and an overflow menu (favorite, rename, share, delete). Favorite/rename/share/delete
// callbacks are passed in by the parent so this row stays a pure presentational component.
export default function SidebarGadgetRow({
  gadget,
  collapsed = false,
  onTogglePin,
  onRename,
  onShare,
  onDelete,
}: {
  gadget: GadgetMetadataWithTimestamps
  collapsed?: boolean
  onTogglePin: (g: GadgetMetadataWithTimestamps) => void
  onRename: (g: GadgetMetadataWithTimestamps, newTitle: string) => void
  onShare: (g: GadgetMetadataWithTimestamps) => void
  onDelete: (g: GadgetMetadataWithTimestamps) => void
}) {
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(gadget.title || '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renaming) inputRef.current?.focus()
  }, [renaming])

  const commit = () => {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== gadget.title) onRename(gadget, trimmed)
    setRenaming(false)
  }

  const startRename = () => {
    setRenameValue(gadget.title || '')
    setRenaming(true)
  }

  return (
    <Link
      to="/workspace/$id"
      params={{ id: gadget.id }}
      className="group flex h-8 items-center gap-2 rounded-lg pl-1.5 pr-1 text-[13px] leading-[18px] tracking-[-0.25px] text-foreground transition-colors hover:bg-muted"
      activeProps={{ className: 'flex h-8 items-center gap-2 rounded-lg pl-1.5 pr-1 text-[13px] leading-[18px] tracking-[-0.25px] bg-accent text-foreground font-medium' }}
      onClick={(e) => {
        if (renaming) e.preventDefault()
      }}
      title={collapsed ? gadget.title || 'Untitled workspace' : undefined}
    >
      <div
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent text-[10px] font-medium text-muted-foreground"
        aria-hidden="true"
      >
        {initials(gadget.title)}
      </div>

      {!collapsed && (
        <>
          {renaming ? (
            <Input
              ref={inputRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit()
                if (e.key === 'Escape') setRenaming(false)
              }}
              className="h-auto min-h-0 min-w-0 flex-1 rounded-none border-0 border-b border-primary bg-transparent px-0 py-0 text-[13px] leading-[18px] tracking-[-0.25px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-0"
              onClick={(e) => e.preventDefault()}
            />
          ) : (
            <span className="min-w-0 flex-1 truncate">{gadget.title || 'Untitled workspace'}</span>
          )}

          {/* Inside the row's <Link>: stopPropagation blocks the Link's SPA handler, so preventDefault
              is needed to stop the native <a> from navigating. */}
          <div onClick={(e) => { e.stopPropagation(); e.preventDefault() }}>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    type="button"
                    aria-label="Workspace actions"
                    className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-[opacity,color,background-color] group-hover:opacity-100 hover:bg-accent hover:text-foreground focus:opacity-100"
                  >
                    <Icons.More size={14} />
                  </Button>
                }
              />
              <DropdownMenuContent className={MENU_CONTENT} style={MENU_POSITIONER_STYLE}>
                <DropdownMenuItem
                  onClick={startRename}
                  className={MENU_ITEM}
                >
                  <Icons.Pencil size={13} className="mr-2" /> Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onTogglePin(gadget)}
                  className={MENU_ITEM}
                >
                  <Icons.Star
                    size={13}
                    className={gadget.pinned ? 'mr-2 text-primary' : 'mr-2'}
                  />
                  {gadget.pinned ? 'Unfavorite' : 'Favorite'}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onShare(gadget)}
                  className={MENU_ITEM}
                >
                  <Icons.Share size={13} className="mr-2" /> Share
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => onDelete(gadget)}
                  className={MENU_ITEM_DANGER}
                >
                  <Icons.Trash size={13} className="mr-2" />
                  {gadget.owner ? 'Dismiss' : 'Delete'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </>
      )}

      {/* Collapsed rows show only the monogram (aria-hidden), so name the link for screen readers. */}
      {collapsed && <span className="sr-only">{gadget.title || 'Untitled workspace'}</span>}
    </Link>
  )
}
