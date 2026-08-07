import {AiChatAuthorInfo, WorkpieceId, validateBindingName } from '@gadgets/workshop-shared/api'
import { ConnectionConfigField } from './ConnectionConfigField'
import { Checkbox, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, type PortalContainer, Input} from '@matser/ui'
// One prospective entry of AgentSpawnerConfig.env: a workpiece the spawned agents may use, and
// the name they see it under. Candidates are prefilled from the gadget the spawner is being
// created for (its own bindings, plus the gadget itself); the user toggles them on or off and may
// rename them. Choosing targets the gadget doesn't already hold isn't supported here yet.
export interface SpawnerEnvRow {
  // The workpiece the entry points at.
  target: WorkpieceId

  // Display name of the target, e.g. the connected resource's title.
  targetTitle: string

  // Name the spawned agents will see the target under (`env.NAME`).
  name: string

  // Whether the entry is included in the spawner's env at all.
  enabled: boolean
}

// Returns a human-readable complaint about the env rows, or null if they're acceptable. Only
// enabled rows matter: a disabled row is simply not part of the env.
export function validateSpawnerEnv(rows: SpawnerEnvRow[]): string | null {
  const seen = new Set<string>()
  for (const row of rows) {
    if (!row.enabled) continue
    try {
      validateBindingName(row.name)
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    }
    if (seen.has(row.name)) {
      return `Two bindings are both named "${row.name}".`
    }
    seen.add(row.name)
  }
  return null
}

// Converts the rows into the AgentSpawnerConfig.env map. Assumes validateSpawnerEnv() passed.
export function spawnerEnvFromRows(rows: SpawnerEnvRow[]): Record<string, WorkpieceId> {
  const env: Record<string, WorkpieceId> = {}
  for (const row of rows) {
    if (row.enabled) env[row.name] = row.target
  }
  return env
}

export interface AgentSpawnerConfigFormProps {
  availableModels: AiChatAuthorInfo[]
  displayName: string
  modelId: string | null
  env: SpawnerEnvRow[]
  envError: string | null
  onDisplayNameChange: (value: string) => void
  onModelIdChange: (id: string | null) => void
  onEnvChange: (env: SpawnerEnvRow[]) => void
  selectContainer?: PortalContainer
}

export function AgentSpawnerConfigForm({
  availableModels,
  displayName,
  modelId,
  env,
  envError,
  onDisplayNameChange,
  onModelIdChange,
  onEnvChange,
  selectContainer,
}: AgentSpawnerConfigFormProps) {
  const updateRow = (index: number, updates: Partial<SpawnerEnvRow>) => {
    onEnvChange(env.map((row, i) => (i === index ? { ...row, ...updates } : row)))
  }

  return (
    <section className="grid gap-4">
      <ConnectionConfigField
        label="Display name"
        description="Name this agent capability for this connection."
      >
        <Input
          aria-label="Agent display name"
          placeholder="e.g. Email Responder"
          value={displayName}
          onChange={(e) => onDisplayNameChange(e.target.value)}
          className="!h-9 rounded-lg border border-border bg-background px-3 text-[13px] leading-[18px] font-normal tracking-[-0.25px] text-foreground placeholder:text-muted-foreground shadow-none focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring/15 w-full"
        />
      </ConnectionConfigField>

      <ConnectionConfigField
        label="Model"
        description="Choose the model spawned agents will use."
      >
        <Select
          value={modelId}
          onValueChange={(v) => onModelIdChange(v as string | null)}
        >
          <SelectTrigger className="w-full text-sm !h-9" aria-label="Agent model"><SelectValue placeholder="Select a model" /></SelectTrigger>
          <SelectContent container={selectContainer}>
            <SelectItem value={null as any}>None (no agent)</SelectItem>
            {availableModels.map(model => <SelectItem key={model.id} value={model.id}>{model.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <p className="mt-1 text-[12px] leading-4 font-normal tracking-[-0.2px] text-muted-foreground">
          Choose "None" to create conversations without an agent.
        </p>
      </ConnectionConfigField>

      <ConnectionConfigField
        label="Agent bindings"
        description="What spawned agents may use, and the names they see it under."
      >
        {env.length === 0 ? (
          <p className="text-[12px] leading-4 font-normal tracking-[-0.2px] text-muted-foreground">
            Nothing is available to offer spawned agents here. Create the agent from a gadget's
            Connections tab to give it access to that gadget and its resources.
          </p>
        ) : (
          <div className="grid gap-2">
            {env.map((row, index) => (
              <div key={`${row.target}:${index}`} className="flex items-center gap-2">
                <Checkbox
                  aria-label={`Give spawned agents access to ${row.targetTitle}`}
                  checked={row.enabled}
                  onCheckedChange={(checked) => updateRow(index, { enabled: checked === true })}
                />
                <Input
                  aria-label={`Binding name for ${row.targetTitle}`}
                  value={row.name}
                  disabled={!row.enabled}
                  onChange={(e) => updateRow(index, { name: e.target.value })}
                  className="!h-9 rounded-lg border border-border bg-background px-3 text-[13px] leading-[18px] font-normal tracking-[-0.25px] text-foreground placeholder:text-muted-foreground shadow-none focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring/15 !h-8 w-[180px] min-w-0 font-mono"
                />
                <span className="min-w-0 flex-1 truncate text-[12px] leading-4 font-normal tracking-[-0.2px] text-muted-foreground">
                  {row.targetTitle}
                </span>
              </div>
            ))}
            {envError && (
              <p className="text-[12px] leading-4 font-normal tracking-[-0.2px] text-destructive">
                {envError}
              </p>
            )}
          </div>
        )}
      </ConnectionConfigField>
    </section>
  )
}
