import { AiChatAuthorInfo } from '@gadgets/workshop-shared/api'
import { ConnectionConfigField } from './ConnectionConfigField'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, type PortalContainer } from '@matser/ui'
export interface AiModelConnectionConfigProps {
  availableModels: AiChatAuthorInfo[]
  selectedModelId: string | undefined
  onSelectedModelIdChange: (id: string | undefined) => void
  selectContainer?: PortalContainer
}

export function AiModelConnectionConfig({
  availableModels,
  selectedModelId,
  onSelectedModelIdChange,
  selectContainer,
}: AiModelConnectionConfigProps) {
  return (
    <section className="grid gap-3">
      <ConnectionConfigField
        label="Model"
        description="Choose the model this connection can use."
      >
        <Select
          value={selectedModelId}
          onValueChange={(v) => onSelectedModelIdChange(v as string | undefined)}
        >
          <SelectTrigger className="w-full text-sm !h-9" aria-label="Select an AI model"><SelectValue placeholder="Select an AI model" /></SelectTrigger>
          <SelectContent container={selectContainer}>{availableModels.map(model => <SelectItem key={model.id} value={model.id}>{model.name}</SelectItem>)}</SelectContent>
        </Select>
      </ConnectionConfigField>
    </section>
  )
}
