import { Link } from '@tanstack/react-router'
import {
  Blueprint as BlueprintIcon,
  Clock,
  Compass,
  DotsThreeVertical,
  MagnifyingGlass,
  Star,
  Trash,
  UploadSimple,
} from '@phosphor-icons/react'
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useAuthenticatedApi } from '../AuthContext'
import { MENU_CONTENT, MENU_ITEM, MENU_ITEM_DANGER } from './menuStyles'
import { DropdownMenu, useToast, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@matser/ui'
// A unified row item, merged from the user's published blueprints (`listOwnBlueprints`) and their
// library (`listLibraryBlueprints`). Mirrors the sidebar's SidebarBlueprintItem but adds the bits
// the full-page list shows (description, timestamp) and tracks whether the user owns it.
type BlueprintItem = {
  id: string
  title: string
  description: string
  recency: number
  pinned: boolean
  inLibrary: boolean
  isOwn: boolean
}

// Chrome shared by the page's secondary actions. `w-full` + `justify-center` are what let a pair of
// these sit in a 2-column grid and come out the same width whatever their labels say.
const ACTION_BUTTON =
  'press inline-flex h-9 w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3.5 text-[13px] font-medium tracking-[-0.25px] text-foreground transition-colors hover:bg-muted disabled:cursor-default disabled:opacity-50'

function formatRelativeTime(date: Date): string {
  const diff = Date.now() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function sortItems(items: BlueprintItem[]): BlueprintItem[] {
  return items.toSorted((a, b) => {
    if (a.pinned && !b.pinned) return -1
    if (!a.pinned && b.pinned) return 1
    return b.recency - a.recency
  })
}

function BlueprintRow({
  item,
  onTogglePin,
  onRemoveFromLibrary,
}: {
  item: BlueprintItem
  onTogglePin: (b: BlueprintItem) => void
  onRemoveFromLibrary: (b: BlueprintItem) => void
}) {
  return (
    <Link
      to="/blueprint/$id"
      params={{ id: item.id }}
      className="group flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition-colors duration-150 ease-out hover:bg-muted"
    >
      {/* Neutral monogram */}
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-accent text-muted-foreground">
        <BlueprintIcon size={16} weight="regular" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {item.pinned && <Star size={12} weight="fill" className="flex-shrink-0 text-primary" />}
          <h3 className="truncate text-sm font-medium text-foreground">
            {item.title || 'Untitled blueprint'}
          </h3>
        </div>
        {item.description && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.description}</p>
        )}
      </div>

      <span className="hidden flex-shrink-0 items-center gap-1 text-xs text-muted-foreground lg:flex">
        <Clock size={10} />
        {formatRelativeTime(new Date(item.recency))}
      </span>

      {/* Inside the row's <Link>: stopPropagation blocks the Link's SPA handler, so preventDefault
          is needed to stop the native <a> from navigating. */}
      <div onClick={(e) => { e.stopPropagation(); e.preventDefault() }}>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
              >
                <DotsThreeVertical size={16} />
              </button>
            }
          />
          <DropdownMenuContent className={MENU_CONTENT}>
            <DropdownMenuItem onClick={() => onTogglePin(item)} className={MENU_ITEM}>
              <Star size={13} className="mr-2" weight={item.pinned ? 'fill' : 'regular'} />
              {item.pinned ? 'Unfavorite' : 'Favorite'}
            </DropdownMenuItem>
            {item.inLibrary && (
              <DropdownMenuItem variant="destructive" onClick={() => onRemoveFromLibrary(item)} className={MENU_ITEM_DANGER}>
                <Trash size={13} className="mr-2" />
                Remove from library
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </Link>
  )
}

export default function BlueprintList() {
  const { authenticatedApi } = useAuthenticatedApi()
  const toasts = useToast()

  const [items, setItems] = useState<BlueprintItem[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [uploading, setUploading] = useState(false)
  const uploadInputRef = useRef<HTMLInputElement>(null)

  // A generation counter so a retry (or unmount) invalidates any in-flight load: only the most
  // recent request is allowed to write state, avoiding races between concurrent loads.
  const loadGenRef = useRef(0)

  const load = useCallback(() => {
    const gen = ++loadGenRef.current
    setLoading(true)
    setLoadError(false)
    Promise.all([authenticatedApi.listOwnBlueprints(), authenticatedApi.listLibraryBlueprints()])
      .then(([own, library]) => {
        if (gen !== loadGenRef.current) return
        const map = new Map<string, BlueprintItem>()
        const ensure = (id: string): BlueprintItem => {
          let it = map.get(id)
          if (!it) {
            it = { id, title: 'Untitled blueprint', description: '', recency: 0, pinned: false, inLibrary: false, isOwn: false }
            map.set(id, it)
          }
          return it
        }
        for (const b of library) {
          const it = ensure(b.id)
          it.title = b.metadata.title || it.title
          it.description = b.metadata.description || it.description
          it.pinned ||= b.pinned === true
          it.recency = Math.max(it.recency, b.addedAt.getTime())
          it.inLibrary = true
        }
        for (const b of own) {
          const it = ensure(b.id)
          it.title = b.title || it.title
          it.description = b.description || it.description
          it.pinned ||= b.pinned === true
          it.recency = Math.max(it.recency, b.lastUpdated.getTime())
          it.isOwn = true
        }
        setItems(sortItems(Array.from(map.values())))
        setLoading(false)
      })
      .catch((err) => {
        console.error('Failed to load blueprints:', err)
        if (gen !== loadGenRef.current) return
        setLoading(false)
        setLoadError(true)
      })
  }, [authenticatedApi])

  useEffect(() => {
    load()
    // Bump the generation on unmount so a late resolve doesn't set state on an unmounted component.
    return () => { loadGenRef.current++ }
  }, [load])

  // Import a `.gadget` archive exported from another Workshop instance, then refresh the list.
  const handleBlueprintSelected = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Clear immediately so re-picking the same file fires `change` again.
    event.target.value = ''
    if (!file) return
    setUploading(true)
    try {
      await authenticatedApi.importBlueprint(file.stream() as ReadableStream<Uint8Array>)
      toasts.add({ title: 'Blueprint uploaded', type: 'success' })
      load()
    } catch (err) {
      console.error('Failed to upload blueprint:', err)
      toasts.add({ title: 'Failed to upload blueprint', type: 'error' })
    } finally {
      setUploading(false)
    }
  }, [authenticatedApi, load, toasts])

  const handleTogglePin = async (item: BlueprintItem) => {
    const nextPinned = !item.pinned
    setItems((prev) => sortItems(prev.map((b) => (b.id === item.id ? { ...b, pinned: nextPinned } : b))))
    try {
      await authenticatedApi.setBlueprintPinned(item.id, nextPinned)
    } catch (err) {
      console.error('Failed to update blueprint pin:', err)
      setItems((prev) => sortItems(prev.map((b) => (b.id === item.id ? { ...b, pinned: item.pinned } : b))))
      toasts.add({ title: 'Failed to update favorite', type: 'error' })
    }
  }

  const handleRemoveFromLibrary = async (item: BlueprintItem) => {
    try {
      await authenticatedApi.removeBlueprintFromLibrary(item.id)
      // If the user also owns it, it stays in the list (just no longer in the library); otherwise
      // it leaves the list entirely.
      setItems((prev) =>
        prev
          .map((b) => (b.id === item.id ? { ...b, inLibrary: false } : b))
          .filter((b) => b.inLibrary || b.isOwn),
      )
      toasts.add({ title: 'Removed from library', type: 'success' })
    } catch (err) {
      console.error('Failed to remove blueprint from library:', err)
      toasts.add({ title: 'Failed to remove blueprint', type: 'error' })
    }
  }

  const filtered = items.filter((b) => {
    if (!search) return true
    const q = search.toLowerCase()
    return b.title.toLowerCase().includes(q) || b.description.toLowerCase().includes(q)
  })

  return (
    <div className="flex h-full flex-col">
      {/* Hidden picker backing both Upload buttons. */}
      <input
        ref={uploadInputRef}
        type="file"
        accept=".gadget"
        className="hidden"
        onChange={handleBlueprintSelected}
      />

      {/* Toolbar — search plus the page's actions. Hidden when the user has no blueprints, since
          the empty state carries its own copies of the same two actions. */}
      {!loading && items.length > 0 && (
        <div className="mb-4 flex items-center gap-2 px-3">
          <div className="relative flex-1">
            <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search blueprints…"
              className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-4 text-[13px] tracking-[-0.25px] text-foreground placeholder:text-muted-foreground transition-[border-color,box-shadow] duration-150 ease-out focus:border-ring focus:outline-none focus:ring-[3px] focus:ring-ring/15"
            />
          </div>
          {/* Grid, not flex: 1fr columns give the two buttons a matching width, where flex would
              size each to its own label. */}
          <div className="grid shrink-0 grid-cols-2 gap-2">
            <Link to="/explore" className={ACTION_BUTTON}>
              <Compass size={14} />
              Explore
            </Link>
            <button
              type="button"
              onClick={() => uploadInputRef.current?.click()}
              disabled={uploading}
              title="Upload a .gadget archive"
              className={ACTION_BUTTON}
            >
              <UploadSimple size={14} weight="bold" />
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
          </div>
        </div>
      )}

      {/* List. Rows carry the px-3 inset; the scroll container has none so the scrollbar sits just
          past the aligned content. */}
      <div className="chat-panel flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pt-1">
        {loading ? (
          <div className="flex flex-col gap-0.5 px-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-[56px] rounded-xl bg-card animate-pulse" />
            ))}
          </div>
        ) : loadError ? (
          <div className="py-12 text-center text-sm">
            <p className="text-destructive">Something went wrong loading your blueprints.</p>
            <button type="button" onClick={load} className="mt-1 text-primary underline">Try again</button>
          </div>
        ) : filtered.length === 0 ? (
          search ? (
            <div className="py-12 text-center text-sm text-muted-foreground">No blueprints found</div>
          ) : (
            <div className="flex flex-col items-center gap-3 px-3 py-16 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-muted-foreground">
                <BlueprintIcon size={18} />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">No blueprints yet</p>
                <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">
                  Publish a workspace as a blueprint, or add one from Explore.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Link to="/explore" className={ACTION_BUTTON}>
                  <Compass size={14} />
                  Explore blueprints
                </Link>
                <button
                  type="button"
                  onClick={() => uploadInputRef.current?.click()}
                  disabled={uploading}
                  className={ACTION_BUTTON}
                >
                  <UploadSimple size={14} weight="bold" />
                  {uploading ? 'Uploading…' : 'Upload .gadget'}
                </button>
              </div>
            </div>
          )
        ) : (
          filtered.map((item) => (
            <BlueprintRow
              key={item.id}
              item={item}
              onTogglePin={handleTogglePin}
              onRemoveFromLibrary={handleRemoveFromLibrary}
            />
          ))
        )}
      </div>
    </div>
  )
}
