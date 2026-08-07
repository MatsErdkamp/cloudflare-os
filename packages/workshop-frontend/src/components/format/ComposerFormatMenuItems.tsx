import type { OutputFormatOffer } from '@gadgets/workshop-shared/api'
import { FormatGlyph } from './FormatVisuals'
import { useOutputFormats } from './useOutputFormats'
import { DropdownMenuItem } from '@matser/ui'
// Matches the surrounding items in the composer menu, which are quieter and rounder than the
// app-wide MENU_ITEM.
const COMPOSER_MENU_ITEM =
  '!h-auto rounded-xl !px-2 !py-1.5 text-[12px] leading-4 font-normal tracking-[-0.15px] ' +
  'text-muted-foreground transition-colors data-highlighted:bg-muted/70 data-highlighted:text-foreground'

export default function ComposerFormatMenuItems({
  onSelect,
}: {
  onSelect: (format: OutputFormatOffer) => void
}) {
  const { formats, creating, create } = useOutputFormats()

  if (formats.length === 0) return null

  const choose = (format: OutputFormatOffer) =>
    format.requiresSetup ? create(format) : onSelect(format)

  return (
    <>
      <p className="px-2 pb-1 pt-1.5 text-[10px] font-medium uppercase leading-4 tracking-[0.06em] text-muted-foreground">
        Start with
      </p>
      {formats.map((format) => (
        <DropdownMenuItem
          key={format.blueprintId}
          className={COMPOSER_MENU_ITEM}
          disabled={creating !== null}
          onClick={() => choose(format)}
        >
          <span className="mr-2 inline-flex h-4 w-4 items-center justify-center text-muted-foreground">
            <FormatGlyph
              output={format.output}
              size="md"
              className={creating === format.blueprintId ? 'animate-pulse' : undefined}
            />
          </span>
          <span className="flex-1 truncate">
            {creating === format.blueprintId ? 'Creating…' : format.output.noun}
          </span>
        </DropdownMenuItem>
      ))}
      <div className="my-1 border-t border-border/70" />
    </>
  )
}
