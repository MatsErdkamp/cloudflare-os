import { useState, useEffect } from 'react'
import { AiChatAuthorInfo, AiModelConfig, AiModelProvider, AiGatewayInfo, SUGGESTED_MODELS } from '@gadgets/workshop-shared/api'
import { RpcStub } from 'capnweb'
import { AuthenticatedApi } from '@gadgets/workshop-shared/api'
import { Dialog, Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SensitiveInput, Collapsible, CollapsibleDefaultPanel, CollapsibleDefaultTrigger, useToast, DialogContent, DialogTitle, DialogClose, Field, FieldLabel, FieldDescription, FieldError } from '@matser/ui'
interface AddModelModalProps {
  visible: boolean
  onCancel: () => void
  onSuccess: () => void
  authenticatedApi: RpcStub<AuthenticatedApi>
  aiConfig: AiGatewayInfo | null
}

type SelectionType =
  | { type: 'suggested', provider: AiModelProvider, modelId: string, displayName: string }
  | { type: 'custom', provider: AiModelProvider }

const PROVIDER_LABELS: Record<AiModelProvider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  cloudflare: 'Cloudflare Workers AI',
  ollama: 'Ollama',
}

// Placeholder hinting at the shape of each provider's API token.
const API_TOKEN_PLACEHOLDERS: Record<AiModelProvider, string> = {
  anthropic: 'sk-ant-...',
  openai: 'sk-...',
  google: 'AIza...',
  cloudflare: 'Cloudflare API token',
  ollama: '(optional)',
}

// Example used in the custom-model placeholders for providers that have no suggested models
// (currently Ollama, which serves whatever the user has pulled locally).
const FALLBACK_EXAMPLE_MODEL = { modelId: 'gemma4:31b', name: 'Gemma 4 31B' }

// Pick an example model to show in the custom-model placeholders for the given provider.
function exampleModel(provider: AiModelProvider): { modelId: string, name: string } {
  const first = Object.entries(SUGGESTED_MODELS[provider])[0]
  return first ? { modelId: first[0], name: first[1].name } : FALLBACK_EXAMPLE_MODEL
}

// Encode a selection into a string value for the Select component.
function encodeSelection(provider: AiModelProvider, modelId?: string): string {
  return modelId ? `${provider}:${modelId}` : `other-${provider}`
}

// Decode a Select value back into a SelectionType.
function decodeSelection(value: string): SelectionType {
  if (value.startsWith('other-')) {
    return { type: 'custom', provider: value.substring(6) as AiModelProvider }
  }
  const colonIndex = value.indexOf(':')
  const provider = value.substring(0, colonIndex) as AiModelProvider
  const modelId = value.substring(colonIndex + 1)
  const displayName = SUGGESTED_MODELS[provider][modelId].name
  return { type: 'suggested', provider, modelId, displayName }
}

// Build the flat list of options for the Select dropdown.
function buildOptions(gatewayMode: boolean, enabledProviders: Set<string> | null) {
  const options: { value: string; label: string; provider: string }[] = []
  const providerOrder = Object.keys(SUGGESTED_MODELS) as AiModelProvider[]

  for (const provider of providerOrder) {
    if (enabledProviders && !enabledProviders.has(provider)) continue

    // In gateway mode, suggested models are already built-in, so don't list them.
    if (!gatewayMode) {
      for (const [modelId, model] of Object.entries(SUGGESTED_MODELS[provider])) {
        options.push({
          value: encodeSelection(provider, modelId),
          label: model.name,
          provider,
        })
      }
    }

    options.push({
      value: encodeSelection(provider),
      label: `Other ${PROVIDER_LABELS[provider] || provider}...`,
      provider,
    })
  }

  return options
}

export default function AddModelModal({ visible, onCancel, onSuccess, authenticatedApi, aiConfig }: AddModelModalProps) {
  const toasts = useToast()

  const [loading, setLoading] = useState(false)
  const [selection, setSelection] = useState<SelectionType | null>(null)
  const [selectValue, setSelectValue] = useState<string | undefined>(undefined)

  // Form fields (used for custom models)
  const [modelId, setModelId] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [apiToken, setApiToken] = useState('')
  const [accountId, setAccountId] = useState('')
  const [apiUrl, setApiUrl] = useState('')

  // Validation errors
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Advanced settings collapsible state
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const gatewayMode = aiConfig?.enabled === true
  const enabledProviders: Set<string> | null = gatewayMode
    ? new Set(aiConfig.enabledProviders)
    : null

  // Reset all state when dialog closes
  useEffect(() => {
    if (!visible) {
      setSelection(null)
      setSelectValue(undefined)
      setModelId('')
      setDisplayName('')
      setApiToken('')
      setAccountId('')
      setApiUrl('')
      setErrors({})
      setAdvancedOpen(false)
    }
  }, [visible])

  const handleModelSelect = (value: string) => {
    setSelectValue(value)
    setErrors({})
    const sel = decodeSelection(value)
    setSelection(sel)

    if (sel.type === 'custom') {
      setModelId('')
      setDisplayName('')
    } else {
      setModelId(sel.modelId)
      setDisplayName(sel.displayName)
    }
    setApiToken('')
    setAccountId('')
    setApiUrl(sel.provider === 'ollama' ? 'http://localhost:11434' : '')
  }

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (!selection) {
      newErrors.selection = gatewayMode ? 'Please select a provider' : 'Please select a model'
    }

    if (selection?.type === 'custom') {
      if (!modelId.trim()) newErrors.modelId = 'Please enter the model ID'
      if (!displayName.trim()) newErrors.displayName = 'Please enter a display name'
    }

    const isOllama = selection?.provider === 'ollama'
    const isCloudflare = selection?.provider === 'cloudflare'
    const showCredentials = !gatewayMode

    if (showCredentials && selection && !isOllama && !apiToken.trim()) {
      newErrors.apiToken = 'Please enter your API token'
    }

    if (showCredentials && isCloudflare && !accountId.trim()) {
      newErrors.accountId = 'Please enter your Cloudflare account ID'
    }

    if (showCredentials && isOllama && !apiUrl.trim()) {
      newErrors.apiUrl = 'Please enter the Ollama API URL'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async () => {
    if (!validate()) return

    setLoading(true)
    try {
      const isSuggested = selection!.type === 'suggested'
      const finalModelId = isSuggested ? selection!.modelId : modelId.trim()
      const finalDisplayName = isSuggested ? selection!.displayName : displayName.trim()

      const profile: AiChatAuthorInfo = {
        type: 'agent',
        id: finalModelId,
        name: finalDisplayName,
      }

      const config: AiModelConfig = {
        provider: selection!.provider,
        model: finalModelId,
        apiToken: gatewayMode ? '' : apiToken.trim(),
        ...(!gatewayMode && accountId.trim() && { accountId: accountId.trim() }),
        ...(!gatewayMode && apiUrl.trim() && { apiUrl: apiUrl.trim() }),
      }

      await authenticatedApi.addModel(profile, config)
      toasts.add({ title: 'AI model added successfully', type: 'success' })
      onSuccess()
    } catch (error: any) {
      console.error('Failed to add model:', error)
      toasts.add({ title: 'Failed to add model', type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const options = buildOptions(gatewayMode, enabledProviders)
  const showCustomFields = selection?.type === 'custom'
  const example = selection ? exampleModel(selection.provider) : null
  const isOllama = selection?.provider === 'ollama'
  const isCloudflare = selection?.provider === 'cloudflare'
  const showCredentials = !gatewayMode

  // Group options by provider for rendering with visual separators.
  const groupedOptions: { provider: string; items: typeof options }[] = []
  for (const opt of options) {
    const last = groupedOptions[groupedOptions.length - 1]
    if (last && last.provider === opt.provider) {
      last.items.push(opt)
    } else {
      groupedOptions.push({ provider: opt.provider, items: [opt] })
    }
  }

  return (
    <Dialog open={visible} onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent className="p-6" size="lg">
        <DialogTitle className="text-lg font-semibold mb-4">
          Add AI Model
        </DialogTitle>

        <div className="space-y-4">
          {/* Model / Provider selection */}
          <Select
            value={selectValue}
            onValueChange={(v) => handleModelSelect(v as string)}
          >
            <SelectTrigger className="w-full text-sm" aria-label={gatewayMode ? 'Select Provider' : 'Select Model'}>
              <SelectValue placeholder={gatewayMode ? 'Choose a provider...' : 'Choose an AI model...'} />
            </SelectTrigger>
            <SelectContent>
              {groupedOptions.flatMap((group) => group.items.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              )))}
            </SelectContent>
          </Select>
          {errors.selection && <p className="text-xs text-destructive">{errors.selection}</p>}

          {/* Custom model fields */}
          {showCustomFields && (
            <>
              <Field>
                <FieldLabel>Model ID</FieldLabel>
                <Input
                  placeholder={`e.g., ${example!.modelId}`}
                  aria-invalid={Boolean(errors.modelId)}
                  value={modelId}
                  onChange={(e) => { setModelId(e.target.value); setErrors(prev => ({ ...prev, modelId: '' })) }}
                />
                <FieldDescription>The model identifier as specified by the provider (e.g., '{example!.modelId}')</FieldDescription>
                {errors.modelId && <FieldError>{errors.modelId}</FieldError>}
              </Field>

              <Field>
                <FieldLabel>Display Name</FieldLabel>
                <Input
                  placeholder={`e.g., ${example!.name}`}
                  aria-invalid={Boolean(errors.displayName)}
                  value={displayName}
                  onChange={(e) => { setDisplayName(e.target.value); setErrors(prev => ({ ...prev, displayName: '' })) }}
                />
                <FieldDescription>Human-readable name shown in the UI</FieldDescription>
                {errors.displayName && <FieldError>{errors.displayName}</FieldError>}
              </Field>
            </>
          )}

          {/* Cloudflare account ID (the Workers AI REST endpoint is account-scoped) */}
          {showCredentials && isCloudflare && (
            <Field>
              <FieldLabel>Cloudflare Account ID</FieldLabel>
              <Input
                placeholder="e.g., 0123456789abcdef0123456789abcdef"
                aria-invalid={Boolean(errors.accountId)}
                value={accountId}
                onChange={(e) => { setAccountId(e.target.value); setErrors(prev => ({ ...prev, accountId: '' })) }}
              />
              <FieldDescription>The Cloudflare account to bill for Workers AI usage</FieldDescription>
              {errors.accountId && <FieldError>{errors.accountId}</FieldError>}
            </Field>
          )}

          {/* API Token */}
          {showCredentials && selection && (
            <Field>
              <FieldLabel>API Token</FieldLabel>
              <SensitiveInput
                placeholder={API_TOKEN_PLACEHOLDERS[selection.provider]}
                aria-invalid={Boolean(errors.apiToken)}
                value={apiToken}
                onChange={(e) => { setApiToken(e.target.value); setErrors(prev => ({ ...prev, apiToken: '' })) }}
              />
              <FieldDescription>
                {isOllama
                  ? 'Optional for local Ollama access'
                  : isCloudflare
                  ? 'An API token with Workers AI Read + Edit permissions (in the dashboard: Workers AI > Use REST API > Create a Workers AI API Token)'
                  : `Your ${PROVIDER_LABELS[selection.provider]} API token for billing`}
              </FieldDescription>
              {errors.apiToken && <FieldError>{errors.apiToken}</FieldError>}
            </Field>
          )}

          {/* Ollama API URL (always visible for Ollama) */}
          {showCredentials && isOllama && (
            <Field>
              <FieldLabel>API URL</FieldLabel>
              <Input
                placeholder="http://localhost:11434"
                aria-invalid={Boolean(errors.apiUrl)}
                value={apiUrl}
                onChange={(e) => { setApiUrl(e.target.value); setErrors(prev => ({ ...prev, apiUrl: '' })) }}
              />
              <FieldDescription>URL of your Ollama server</FieldDescription>
              {errors.apiUrl && <FieldError>{errors.apiUrl}</FieldError>}
            </Field>
          )}

          {/* Advanced Settings for non-Ollama, non-Cloudflare providers */}
          {showCredentials && selection && !isOllama && !isCloudflare && (
            <Collapsible
              open={advancedOpen}
              onOpenChange={setAdvancedOpen}
            >
              <CollapsibleDefaultTrigger>Advanced Settings</CollapsibleDefaultTrigger>
              <CollapsibleDefaultPanel>
                <Field>
                  <FieldLabel>API URL</FieldLabel>
                  <Input
                    placeholder="https://..."
                    value={apiUrl}
                    onChange={(e) => setApiUrl(e.target.value)}
                  />
                  <FieldDescription>Override the default API endpoint (useful for proxies like Cloudflare AI Gateway)</FieldDescription>
                </Field>
              </CollapsibleDefaultPanel>
            </Collapsible>
          )}
        </div>

        {/* Footer */}
        <div className="mt-6 flex justify-end gap-2">
          <DialogClose render={(props) => (
            <Button variant="secondary" {...props} disabled={loading}>
              Cancel
            </Button>
          )} />
          <Button
            variant="primary"
            onClick={handleSubmit}
            loading={loading}
            disabled={!selection}
          >
            Add Model
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
