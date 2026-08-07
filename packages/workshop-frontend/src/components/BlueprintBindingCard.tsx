import type { RpcStub } from 'capnweb'
import {GatekeeperIcon } from './GatekeeperIcon'
import type { BlueprintBindingAnnotation, GadgetClient, GatekeeperCreationSpec } from '@gadgets/workshop-shared/api'
import { Checkbox, Input, Textarea} from '@matser/ui'
export type BindingCardData = {
  bindingName: string
  resourceTitle: string
  vendorId?: string
  creationSpec: GatekeeperCreationSpec
  annotation: BlueprintBindingAnnotation
}

export function suggestValueLabel(spec: GatekeeperCreationSpec, title?: string): string {
  const displayTitle = title?.trim()
  switch (spec.type) {
    case 'gatekeeper':
      return displayTitle ? `Suggest "${displayTitle}" by default` : 'Suggest this resource by default'
    case 'aiModel':
      return displayTitle ? `Suggest "${displayTitle}" by default` : 'Suggest this model by default'
    case 'agentSpawner':
      return displayTitle ? `Suggest "${displayTitle}" by default` : 'Suggest this agent setup by default'
    case 'ambient':
      // Ambient resources are auto-provided and excluded from blueprints, so this never renders.
      return 'Suggest this by default'
  }
}

export function BlueprintBindingCard({
  data,
  onChange,
  autoFocusDescription,
  flat = false,
}: {
  data: BindingCardData
  onChange: (annotation: BlueprintBindingAnnotation) => void
  autoFocusDescription?: boolean
  /** When true, render without the outer card chrome (border, background, divider). */
  flat?: boolean
}) {
  const { bindingName, resourceTitle, vendorId, creationSpec, annotation } = data
  const titleId = `blueprint-binding-title-${bindingName}`
  const descriptionId = `blueprint-binding-desc-${bindingName}`
  const displayTitle = annotation.title || resourceTitle || bindingName

  const containerClass = flat
    ? 'space-y-3'
    : 'rounded-xl border border-border bg-background'
  const headerClass = flat
    ? 'flex items-start gap-3'
    : 'flex items-start gap-3 px-3 pt-3'
  const descriptionWrapperClass = flat ? '' : 'px-3 pt-2'
  const footerClass = flat
    ? 'flex items-center [&_label]:!text-[12px] [&_label]:!leading-4 [&_label]:!tracking-[-0.2px] [&_label]:!font-normal [&_label]:!text-muted-foreground'
    : 'mt-2 flex items-center border-t border-border/70 px-3 py-2 [&_label]:!text-[12px] [&_label]:!leading-4 [&_label]:!tracking-[-0.2px] [&_label]:!font-normal [&_label]:!text-muted-foreground'

  return (
    <div className={containerClass}>
      <div className={headerClass}>
        <GatekeeperIcon vendorId={vendorId} fallbackText={resourceTitle || bindingName} />
        <div className="min-w-0 flex-1">
          <label htmlFor={titleId} className="sr-only">Connection name</label>
          <Input
            id={titleId}
            aria-label={`Name for ${bindingName}`}
            value={annotation.title}
            onChange={(e) => onChange({ ...annotation, title: e.target.value })}
            placeholder="Connection name"
            className="!h-9 rounded-lg border border-border bg-background px-3 text-[13px] leading-[18px] font-normal tracking-[-0.25px] text-foreground placeholder:text-muted-foreground shadow-none focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring/15 !h-8 w-full bg-background text-[13px] leading-5 font-medium tracking-[-0.25px]"
          />
          <p className="mt-1 text-[11px] leading-4 tracking-[-0.1px] text-muted-foreground">
            Referenced in code as: <span className="font-mono text-muted-foreground">{bindingName}</span>
          </p>
        </div>
      </div>

      <div className={descriptionWrapperClass}>
        <Textarea
          id={descriptionId}
          aria-label={`Help text for ${displayTitle}`}
          value={annotation.description}
          onChange={(e) => onChange({ ...annotation, description: e.target.value })}
          placeholder="What should people connect here?"
          rows={2}
          autoFocus={autoFocusDescription}
          className="rounded-lg border border-border bg-background px-3 py-2 text-[13px] leading-[18px] font-normal tracking-[-0.25px] text-foreground placeholder:text-muted-foreground shadow-none focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring/15 w-full resize-none"
        />
      </div>

      <div className={footerClass}>
        <label className="inline-flex items-center gap-2 text-sm text-foreground">
          <Checkbox
            checked={annotation.suggestValue ?? false}
            onCheckedChange={(checked) =>
              onChange({ ...annotation, suggestValue: checked === true })
            }
          />
          <span>{suggestValueLabel(creationSpec, resourceTitle)}</span>
        </label>
      </div>
    </div>
  )
}

export function defaultAnnotation(): BlueprintBindingAnnotation {
  return { title: '', description: '', suggestValue: false }
}

export async function loadBindingCardData(
  gadget: RpcStub<GadgetClient>,
  meta: { name: string; resourceTitle: string; vendorId?: string },
): Promise<BindingCardData | null> {
  const gk = await gadget.getBinding(meta.name)
  try {
    if (!gk) return null
    const creationSpecP = gk.getCreationSpec()
    const annotationP = gadget.getBlueprintAnnotation(meta.name)
    const [creationSpec, existing] = await Promise.all([creationSpecP, annotationP])
    return {
      bindingName: meta.name,
      resourceTitle: meta.resourceTitle,
      vendorId: meta.vendorId,
      creationSpec,
      annotation: existing ?? { ...defaultAnnotation(), title: meta.resourceTitle || meta.name },
    }
  } finally {
    gk?.[Symbol.dispose]()
  }
}
