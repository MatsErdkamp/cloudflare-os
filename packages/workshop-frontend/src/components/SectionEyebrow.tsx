export function SectionEyebrow({ label, count }: { label: string; count?: number }) {
  return (
    <div className="mb-3.5 flex items-center gap-3 px-1">
      <h2 className="m-0 text-[11px] leading-4 font-semibold uppercase tracking-[0.9px] text-muted-foreground">
        {label}
      </h2>
      <div className="h-px flex-1 bg-border" />
      {typeof count === 'number' && (
        <span className="text-[11px] leading-4 font-semibold tracking-[-0.1px] text-muted-foreground">
          {count}
        </span>
      )}
    </div>
  )
}
