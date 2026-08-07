// "Start with a format": one click per standard output the deployment offers. Renders nothing when
// it promotes none, which is the default.

import { FormatGlyph } from './FormatVisuals'
import { useOutputFormats } from './useOutputFormats'

export default function NewFormatRow({ label = 'Start with' }: { label?: string }) {
  const { formats, creating, create } = useOutputFormats()

  if (formats.length === 0) return null

  return (
    <div className="flex flex-col items-center gap-2.5">
      <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </span>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {formats.map((format) => (
          <button
            key={format.blueprintId}
            type="button"
            disabled={creating !== null}
            onClick={() => create(format)}
            title={format.description || undefined}
            className="press flex cursor-pointer items-center gap-2 rounded-full border border-border bg-background px-3.5 py-2 text-[13px] leading-[18px] tracking-[-0.25px] text-foreground transition-colors duration-150 ease-out hover:bg-muted disabled:cursor-default disabled:opacity-60"
          >
            <FormatGlyph
              output={format.output}
              size="md"
              className={creating === format.blueprintId ? 'animate-pulse' : 'text-muted-foreground'}
            />
            {creating === format.blueprintId ? `Creating…` : `New ${format.output.noun}`}
          </button>
        ))}
      </div>
    </div>
  )
}
