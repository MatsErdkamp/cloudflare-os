import { useMemo, useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { AdminApi, ContractorsDependencyPolicy } from '@gadgets/workshop-shared/api'
import { Button, Input, Textarea, useToast } from '@matser/ui'
interface AdminContractorsPanelProps {
  admin: RpcStub<AdminApi>
  policy: ContractorsDependencyPolicy
  onChanged(policy: ContractorsDependencyPolicy): void
}

function packageLines(values: string[] | undefined): string {
  return values?.join('\n') ?? ''
}

function versionLines(values: Record<string, string> | undefined): string {
  return Object.entries(values ?? {}).map(([name, version]) => `${name}@${version}`).join('\n')
}

function parsePackageLines(value: string): string[] | undefined {
  const entries = value.split(/[\n,]/).map(item => item.trim()).filter(Boolean)
  return entries.length > 0 ? entries : undefined
}

function parseVersionLines(value: string): Record<string, string> | undefined {
  const result: Record<string, string> = {}
  for (const line of value.split('\n').map(item => item.trim()).filter(Boolean)) {
    const separator = line.lastIndexOf('@')
    if (separator <= 0 || separator === line.length - 1) {
      throw new Error(`Expected “package@exact-version”, received “${line}”.`)
    }
    result[line.slice(0, separator)] = line.slice(separator + 1)
  }
  return Object.keys(result).length > 0 ? result : undefined
}

export default function AdminContractorsPanel({
  admin,
  policy,
  onChanged,
}: AdminContractorsPanelProps) {
  const toasts = useToast()
  const [allowedPackages, setAllowedPackages] = useState(packageLines(policy.allowedPackages))
  const [deniedPackages, setDeniedPackages] = useState(packageLines(policy.deniedPackages))
  const [allowedVersions, setAllowedVersions] = useState(versionLines(policy.allowedVersions))
  const [maxBundleBytes, setMaxBundleBytes] = useState(
    policy.maxBundleBytes === undefined ? '' : String(policy.maxBundleBytes),
  )
  const [saving, setSaving] = useState(false)

  const saved = useMemo(() => JSON.stringify(policy), [policy])
  let draft: ContractorsDependencyPolicy | undefined
  let draftError: string | undefined
  try {
    const parsedMax = maxBundleBytes.trim() === '' ? undefined : Number(maxBundleBytes)
    if (parsedMax !== undefined && (!Number.isSafeInteger(parsedMax) || parsedMax < 0)) {
      throw new Error('Maximum bundle size must be a non-negative whole number of bytes.')
    }
    draft = {
      ...(parsePackageLines(allowedPackages) ? {allowedPackages: parsePackageLines(allowedPackages)} : {}),
      ...(parsePackageLines(deniedPackages) ? {deniedPackages: parsePackageLines(deniedPackages)} : {}),
      ...(parseVersionLines(allowedVersions) ? {allowedVersions: parseVersionLines(allowedVersions)} : {}),
      ...(parsedMax !== undefined ? {maxBundleBytes: parsedMax} : {}),
    }
  } catch (error) {
    draftError = error instanceof Error ? error.message : 'Invalid dependency policy.'
  }
  const dirty = draft !== undefined && JSON.stringify(draft) !== saved

  const save = async () => {
    if (!draft || draftError) return
    setSaving(true)
    try {
      await admin.setContractorsDependencyPolicy(draft)
      onChanged(draft)
      toasts.add({title: 'Contract dependency policy saved', type: 'success'})
    } catch (error) {
      toasts.add({
        title: error instanceof Error ? error.message : 'Failed to save dependency policy',
        type: 'error',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-card border border-border rounded-xl p-6 space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Contract dependency policy</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Governs npm dependencies before a Contract can be proposed. Empty allow and deny lists
          permit any installed exact-version dependency.
        </p>
      </div>

      <label className="block">
        <span className="block text-sm font-medium text-foreground mb-2">Allowed packages</span>
        <Textarea
          className="w-full"
          value={allowedPackages}
          onChange={(event) => setAllowedPackages(event.target.value)}
          rows={4}
          placeholder={'zod\n@acme/contract-utils'}
        />
        <span className="block text-xs text-muted-foreground mt-1">One npm package name per line.</span>
      </label>

      <label className="block">
        <span className="block text-sm font-medium text-foreground mb-2">Denied packages</span>
        <Textarea
          className="w-full"
          value={deniedPackages}
          onChange={(event) => setDeniedPackages(event.target.value)}
          rows={4}
          placeholder="left-pad"
        />
      </label>

      <label className="block">
        <span className="block text-sm font-medium text-foreground mb-2">Allowed exact versions</span>
        <Textarea
          className="w-full"
          value={allowedVersions}
          onChange={(event) => setAllowedVersions(event.target.value)}
          rows={4}
          placeholder={'zod@4.2.0\n@acme/contract-utils@1.3.0'}
          aria-invalid={Boolean(draftError?.startsWith('Expected'))}
        />
      </label>

      <label className="block">
        <span className="block text-sm font-medium text-foreground mb-2">Maximum bundle size (bytes)</span>
        <Input
          type="number"
          min={0}
          step={1}
          value={maxBundleBytes}
          onChange={(event) => setMaxBundleBytes(event.target.value)}
          placeholder="No limit"
        />
      </label>

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-destructive">{draftError}</span>
        <Button
          variant="primary"
          size="sm"
          onClick={save}
          loading={saving}
          disabled={!dirty || Boolean(draftError)}
        >
          Save policy
        </Button>
      </div>
    </div>
  )
}
