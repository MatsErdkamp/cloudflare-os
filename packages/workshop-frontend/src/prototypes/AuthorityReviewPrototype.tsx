// PROTOTYPE — throw away after deciding the Workspace Authority review experience.
// Three structurally different variants on /authority-prototype, switchable via ?variant=.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import {
  ArrowLeft,
  ArrowRight,
  ArrowsClockwise,
  BracketsCurly,
  CaretRight,
  Check,
  CheckCircle,
  Clock,
  ClockCounterClockwise,
  Database,
  FileCode,
  GitBranch,
  ListChecks,
  LockKey,
  MagnifyingGlass,
  PlugsConnected,
  ShieldCheck,
  SquaresFour,
  UserCircle,
  Users,
  Warning,
  WarningCircle,
  XCircle,
} from '@phosphor-icons/react'
import { Button } from '@matser/ui'
import type { AuthorityPrototypeVariant } from '../routes/authority-prototype'

type Scenario = 'reviewable' | 'stale' | 'cleanup'
type DecisionId = 'storage' | 'github' | 'workload' | 'legacy'

type PrototypeState = {
  variant: AuthorityPrototypeVariant
  scenario: Scenario
  selectedDecision: DecisionId
  environment: 'Development'
  bindingSet: 'development@v7'
  authoritySession: 'owner · epoch 12'
  lastPreview: string | null
}

type Decision = {
  id: DecisionId
  title: string
  eyebrow: string
  status: 'ready' | 'ambiguous' | 'pending' | 'blocked'
  reason: string
  binding: string
  required: boolean
  mode: 'shared' | 'personal' | 'verified'
  consumer: string
}

const decisions: Decision[] = [
  {
    id: 'storage',
    title: 'Approve R2 contract and install it',
    eyebrow: 'Artifact + placement · two decisions',
    status: 'ready',
    reason: 'Exact evidence and one eligible workspace Source',
    binding: 'STORAGE',
    required: true,
    mode: 'shared',
    consumer: 'local-dev · Development Session template',
  },
  {
    id: 'github',
    title: 'Choose the GitHub issue Source',
    eyebrow: 'Placement blocked',
    status: 'ambiguous',
    reason: 'Two eligible personal Sources; selection is not consent',
    binding: 'ISSUES',
    required: false,
    mode: 'personal',
    consumer: 'local-dev · named developer Mat',
  },
  {
    id: 'workload',
    title: 'Finish production workload rotation',
    eyebrow: 'External effect pending',
    status: 'pending',
    reason: 'Next Service Binding subject proved; old deployment cleanup pending',
    binding: 'STORAGE',
    required: true,
    mode: 'verified',
    consumer: 'invoice-worker · production',
  },
  {
    id: 'legacy',
    title: 'Repair legacy Slack binding',
    eyebrow: 'Migration blocker',
    status: 'blocked',
    reason: 'Provider identity and Review Bundle provenance are unknown',
    binding: 'SLACK',
    required: false,
    mode: 'personal',
    consumer: 'Gadget #0 · compatibility only',
  },
]

const variantNames: Record<AuthorityPrototypeVariant, string> = {
  A: 'Decision inbox',
  B: 'Authority map',
  C: 'Evidence ledger',
}

const variants: AuthorityPrototypeVariant[] = ['A', 'B', 'C']

function statusTone(status: Decision['status']): string {
  if (status === 'ready') return 'border-status-success/30 bg-status-success-muted text-status-success'
  if (status === 'ambiguous') return 'border-status-warning/30 bg-status-warning-muted text-status-warning'
  if (status === 'pending') return 'border-status-info/30 bg-status-info-muted text-status-info'
  return 'border-destructive/30 bg-destructive-muted text-destructive'
}

function StatusPill({ decision }: { decision: Decision }) {
  const icon = decision.status === 'ready' ? <CheckCircle size={13} />
    : decision.status === 'ambiguous' ? <WarningCircle size={13} />
    : decision.status === 'pending' ? <Clock size={13} />
    : <XCircle size={13} />
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-medium ${statusTone(decision.status)}`}>
      {icon}{decision.status}
    </span>
  )
}

function Mono({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-foreground">{children}</code>
}

function PageHeader({ scenario, onScenario }: { scenario: Scenario; onScenario: (value: Scenario) => void }) {
  return (
    <header className="border-b border-border bg-background px-6 py-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck size={15} className="text-primary" />
            Workspace Authority · Northstar billing
          </div>
          <h1 className="text-xl font-semibold tracking-[-0.35px]">Review and control capability authority</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Owner session · authority epoch 12 · this access does not grant build or use permission
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
          {(['reviewable', 'stale', 'cleanup'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onScenario(value)}
              className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${scenario === value ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
            >
              {value === 'reviewable' ? 'Reviewable' : value === 'stale' ? 'Stale conflict' : 'Cleanup pending'}
            </button>
          ))}
        </div>
      </div>
      {scenario !== 'reviewable' && (
        <div className={`mt-4 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs ${scenario === 'stale' ? 'border-status-warning/30 bg-status-warning-muted text-status-warning' : 'border-status-info/30 bg-status-info-muted text-status-info'}`}>
          {scenario === 'stale' ? <Warning size={16} /> : <ArrowsClockwise size={16} />}
          <div>
            <strong>{scenario === 'stale' ? 'Decision preconditions changed.' : 'Local authority committed; cleanup is retrying.'}</strong>{' '}
            {scenario === 'stale'
              ? 'Binding generation is now 43, but this review expected 42. Refreshing cannot silently preserve the choice.'
              : 'The new binding is authoritative. Provider cleanup remains visible and cannot switch authority back.'}
          </div>
        </div>
      )}
    </header>
  )
}

function ExactTuple({ decision }: { decision: Decision }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Exact placement tuple</h3>
        <Mono>binding generation 42</Mono>
      </div>
      <dl className="grid grid-cols-[112px_1fr] gap-x-3 gap-y-2 text-xs">
        <dt className="text-muted-foreground">Project</dt><dd>Northstar billing <Mono>prj_7eb2</Mono></dd>
        <dt className="text-muted-foreground">Environment</dt><dd>Development <Mono>env_c31a</Mono></dd>
        <dt className="text-muted-foreground">Binding Set</dt><dd><Mono>development@v7</Mono></dd>
        <dt className="text-muted-foreground">Requirement</dt><dd>{decision.binding} · {decision.required ? 'required' : 'optional'} <Mono>req_8f91@v3</Mono></dd>
        <dt className="text-muted-foreground">Consumer</dt><dd>{decision.consumer}</dd>
        <dt className="text-muted-foreground">Authority mode</dt><dd>{decision.mode} · no fallback</dd>
        <dt className="text-muted-foreground">Shared state</dt><dd>fresh namespace <Mono>state_9d10</Mono></dd>
      </dl>
    </div>
  )
}

function ReviewEvidence() {
  const sections = [
    ['Original source', '+42 −8', 'Exact modules; one heuristic rename'],
    ['Emitted executable', '+19 −6', 'Artifact authority fields changed'],
    ['Public interface', '+1 method', 'putObject() adds conditional metadata'],
    ['Source declaration', 'unchanged', 'R2Bucket root type'],
    ['Dependencies', '+1 −1', 'aws4fetch removed; native signing'],
    ['Toolchain & recipe', 'updated', 'esbuild 0.25.1 → 0.25.4'],
    ['Origin & authorship', 'changed', 'Repository claim; commit is provenance only'],
  ]
  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="border-b border-border p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Artifact Approval candidate</h3>
            <p className="mt-1 text-xs text-muted-foreground">Exact reproducible evidence, not a semantic summary</p>
          </div>
          <span className="inline-flex items-center gap-1 text-xs font-medium text-status-success"><Check size={14} /> 2 exact rebuilds</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
          <div><span className="text-muted-foreground">Artifact</span><br/><Mono>sha256:11f9…8a2c</Mono></div>
          <div><span className="text-muted-foreground">Review Bundle</span><br/><Mono>sha256:27aa…de91</Mono></div>
          <div><span className="text-muted-foreground">Comparison</span><br/><Mono>sha256:a1e4…770b</Mono></div>
          <div><span className="text-muted-foreground">Baseline</span><br/><Mono>approval epoch 4</Mono></div>
          <div><span className="text-muted-foreground">Generator</span><br/><Mono>comparison/v1.3</Mono></div>
          <div><span className="text-muted-foreground">Policy snapshot</span><br/><Mono>sha256:918c…6d10</Mono></div>
        </div>
      </div>
      <div className="divide-y divide-border">
        {sections.map(([name, delta, note]) => (
          <button key={name} type="button" className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/60">
            <CaretRight size={13} className="text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-medium">{name}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{note}</span>
            </span>
            <span className="text-[11px] font-medium">{delta}</span>
          </button>
        ))}
      </div>
      <div className="border-t border-border px-4 py-3 text-[11px] text-muted-foreground">
        Patches may be truncated for display. Exact old/new hashes remain visible; <button className="font-medium text-primary underline">fetch full evidence</button>.
      </div>
    </section>
  )
}

function CandidateChoice({ decision }: { decision: Decision }) {
  if (decision.id !== 'github') return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="text-sm font-semibold">Selected Source</h3>
      <div className="mt-3 flex items-start justify-between gap-3 rounded-lg border border-status-success/25 bg-status-success-muted p-3">
        <div>
          <div className="text-xs font-medium">Workspace R2 · invoices</div>
          <div className="mt-1 text-[11px] text-muted-foreground">Workspace-owned · authority protocol v1 · healthy</div>
          <div className="mt-2 flex gap-2"><Mono>account fp …7A2C</Mono><Mono>resource fp …91D0</Mono></div>
        </div>
        <CheckCircle size={18} className="text-status-success" />
      </div>
    </div>
  )
  return (
    <div className="rounded-xl border border-status-warning/30 bg-card p-4">
      <h3 className="text-sm font-semibold">Explicit Source selection required</h3>
      <p className="mt-1 text-xs text-muted-foreground">Discovery found two candidates. Choosing one does not create or renew personal consent.</p>
      <div className="mt-3 space-y-2">
        {['Personal GitHub · Acme issues · fp …A901', 'Personal GitHub · Side project · fp …5C11'].map((candidate) => (
          <label key={candidate} className="flex cursor-pointer items-center gap-2 rounded-lg border border-border p-3 text-xs hover:bg-muted/60">
            <input type="radio" name="candidate" /> {candidate}
          </label>
        ))}
      </div>
      <div className="mt-3 rounded-lg bg-status-warning-muted p-3 text-[11px] text-status-warning">
        Mat must grant consent through the separate personal Source flow. An Authority Manager cannot do it here.
      </div>
    </div>
  )
}

function TwoDecisionFooter({ scenario, onPreview }: { scenario: Scenario; onPreview: (value: string) => void }) {
  const disabled = scenario === 'stale'
  return (
    <div className="sticky bottom-0 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
      <div className="mb-3 flex items-start gap-2 rounded-lg bg-muted p-3 text-[11px]">
        <ListChecks size={16} className="mt-0.5 text-primary" />
        <span><strong>One confirmation, two durable decisions.</strong> Artifact Approval and Installation Decision receive distinct IDs, request digests, and event sequences under the same Authority Operation.</span>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => onPreview('Rejected both draft decisions')}>Reject</Button>
        <Button disabled={disabled} onClick={() => onPreview('Previewed Approval epoch 5 + Installation Decision inst_dec_72b1')}>
          Review two decisions
        </Button>
      </div>
    </div>
  )
}

function DecisionInspector({ decision, scenario, onPreview }: { decision: Decision; scenario: Scenario; onPreview: (value: string) => void }) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="border-b border-border p-4">
        <div className="mb-2 flex items-center justify-between gap-3"><StatusPill decision={decision}/><Mono>op_4e21 · step review-02</Mono></div>
        <h2 className="text-lg font-semibold tracking-[-0.25px]">{decision.title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{decision.reason}</p>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <ExactTuple decision={decision} />
        <CandidateChoice decision={decision} />
        {decision.id === 'storage' && <ReviewEvidence />}
        {decision.id === 'workload' && <WorkloadRotation />}
        {decision.id === 'legacy' && <LegacyBlocker />}
        <Preconditions scenario={scenario} />
      </div>
      {decision.id === 'storage' && <TwoDecisionFooter scenario={scenario} onPreview={onPreview} />}
    </div>
  )
}

function Preconditions({ scenario }: { scenario: Scenario }) {
  return (
    <details className="rounded-xl border border-border bg-card p-4 text-xs">
      <summary className="cursor-pointer font-medium">Exact hidden commit preconditions</summary>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
        <span>authority epoch <Mono>12</Mono></span><span>permission generation <Mono>8</Mono></span>
        <span>proposal revision <Mono>17</Mono></span><span>binding generation <Mono>{scenario === 'stale' ? 'expected 42 · current 43' : '42'}</Mono></span>
        <span>approval epoch <Mono>5</Mono></span><span>Source generation <Mono>9</Mono></span>
      </div>
    </details>
  )
}

function WorkloadRotation() {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="text-sm font-semibold">Service Binding rotation</h3>
      <div className="mt-3 grid grid-cols-5 gap-1 text-center text-[10px]">
        {['prepared next', 'proved', 'finalized', 'old invalid', 'cleanup pending'].map((step, index) => (
          <div key={step} className={`rounded-md border px-1 py-2 ${index < 4 ? 'border-status-success/30 bg-status-success-muted text-status-success' : 'border-status-info/30 bg-status-info-muted text-status-info'}`}>{step}</div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">Same-account deployment-configuration identity · adapter <Mono>cloudflare-service-binding.v1</Mono> · no script attestation. Worker name, route, repository, and version are non-authoritative.</p>
      <p className="mt-2 text-[11px] text-muted-foreground">Verified mode uses a separate service verifier receipt expiring in 11 minutes. Workload identity does not satisfy it.</p>
    </div>
  )
}

function LegacyBlocker() {
  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive-muted p-4 text-xs text-destructive">
      <div className="flex items-center gap-2 font-semibold"><LockKey size={16}/> Ineligible for Project placement</div>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-[11px]">
        <li>Provider Account Identity: unknown</li>
        <li>Provider Resource Identity: unknown</li>
        <li>Original source/build evidence: unknown</li>
        <li>Historical actor and time: unknown</li>
      </ul>
      <p className="mt-2">The binding remains usable by its Gadget. Reconnect and rebuild can create new reviewed records; they cannot backfill history.</p>
    </div>
  )
}

function VariantA({ state, select, preview }: VariantProps) {
  const selected = decisions.find((decision) => decision.id === state.selectedDecision) ?? decisions[0]
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[190px_330px_minmax(430px,1fr)] overflow-hidden">
      <aside className="border-r border-border bg-card p-3">
        <div className="px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Authority areas</div>
        {[
          [ListChecks, 'Decision inbox', '4'], [SquaresFour, 'Projects & environments', ''],
          [Database, 'Accounts & Sources', '2'], [FileCode, 'Artifacts', '1'],
          [PlugsConnected, 'Consumers & bindings', '3'], [Users, 'Authority managers', ''],
          [ClockCounterClockwise, 'Audit events', ''],
        ].map(([Icon, label, count], index) => {
          const IconComponent = Icon as typeof ListChecks
          return <button key={String(label)} type="button" className={`mb-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs ${index === 0 ? 'bg-selection-bg font-medium text-selection-text' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}><IconComponent size={15}/><span className="flex-1">{String(label)}</span>{count && <span>{String(count)}</span>}</button>
        })}
        <div className="mt-4 rounded-lg border border-border bg-background p-3 text-[11px] text-muted-foreground">
          <div className="mb-1 flex items-center gap-1.5 font-medium text-foreground"><UserCircle size={14}/> Owner control</div>
          Rotate authority epoch and Emergency Retraction are separate actions.
        </div>
      </aside>
      <section className="min-h-0 overflow-y-auto border-r border-border bg-background">
        <div className="sticky top-0 z-10 border-b border-border bg-background p-3">
          <div className="relative"><MagnifyingGlass size={14} className="absolute left-2.5 top-2.5 text-muted-foreground"/><input name="decision-filter" readOnly placeholder="Filter decisions" className="h-9 w-full rounded-lg border border-border bg-card pl-8 pr-3 text-xs outline-none"/></div>
        </div>
        <div className="divide-y divide-border">
          {decisions.map((decision) => (
            <button key={decision.id} type="button" onClick={() => select(decision.id)} className={`w-full p-4 text-left ${state.selectedDecision === decision.id ? 'bg-selection-bg' : 'hover:bg-muted/50'}`}>
              <div className="mb-2 flex items-center justify-between gap-2"><span className="text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground">{decision.eyebrow}</span><StatusPill decision={decision}/></div>
              <div className="text-sm font-medium">{decision.title}</div>
              <div className="mt-1 text-xs text-muted-foreground">{decision.binding} · {decision.mode} · {decision.required ? 'required' : 'optional'}</div>
            </button>
          ))}
        </div>
      </section>
      <DecisionInspector decision={selected} scenario={state.scenario} onPreview={preview}/>
    </div>
  )
}

type VariantProps = {
  state: PrototypeState
  select: (id: DecisionId) => void
  preview: (value: string) => void
}

function BindingNode({ decision, selected, onClick }: { decision: Decision; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`w-full rounded-xl border p-3 text-left shadow-sm transition ${selected ? 'border-primary bg-selection-bg ring-2 ring-primary/15' : 'border-border bg-background hover:border-primary/40'}`}>
      <div className="flex items-center justify-between"><Mono>{decision.binding}</Mono><StatusPill decision={decision}/></div>
      <div className="mt-2 text-xs font-medium">{decision.mode} · {decision.required ? 'required' : 'optional'}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">{decision.consumer}</div>
    </button>
  )
}

function VariantB({ state, select, preview }: VariantProps) {
  const selected = decisions.find((decision) => decision.id === state.selectedDecision) ?? decisions[0]
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-muted/35">
      <div className="min-w-0 flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-6xl">
          <div className="mb-4 flex items-center justify-between">
            <div><h2 className="text-base font-semibold">Northstar billing authority map</h2><p className="text-xs text-muted-foreground">Definitions flow left to right; status is durable, not inferred from position.</p></div>
            <div className="flex gap-2"><Mono>Project prj_7eb2</Mono><Mono>Binding Set development@v7</Mono></div>
          </div>
          <div className="grid grid-cols-[220px_1fr_240px] gap-4">
            <section className="space-y-3">
              <MapColumnHeader icon={<GitBranch size={16}/>} title="Environment" note="Authority target" />
              <div className="rounded-xl border border-primary/30 bg-background p-4 shadow-sm">
                <div className="text-sm font-semibold">Development</div><div className="mt-1 text-[11px] text-muted-foreground">env_c31a · generation 6</div>
                <div className="mt-3 rounded-lg bg-status-warning-muted p-2 text-[11px] text-status-warning">1 required binding blocks readiness</div>
              </div>
              <div className="rounded-xl border border-border bg-card p-3 text-[11px] text-muted-foreground"><strong className="text-foreground">Repository claim</strong><br/>github.com/acme/northstar<br/><span className="italic">discovery only · no authority</span></div>
            </section>
            <section className="space-y-3">
              <MapColumnHeader icon={<BracketsCurly size={16}/>} title="Binding requirements" note="Exact set version" />
              <div className="grid grid-cols-2 gap-3">{decisions.map((decision) => <BindingNode key={decision.id} decision={decision} selected={decision.id === state.selectedDecision} onClick={() => select(decision.id)}/>)}</div>
              <div className="rounded-xl border border-dashed border-border bg-background/70 p-4">
                <div className="mb-2 text-xs font-semibold">Readiness calculation</div>
                <div className="grid grid-cols-4 gap-2 text-center text-[10px]">
                  <div className="rounded bg-status-success-muted p-2 text-status-success">STORAGE active</div>
                  <div className="rounded bg-status-warning-muted p-2 text-status-warning">ISSUES optional</div>
                  <div className="rounded bg-status-info-muted p-2 text-status-info">rotation pending</div>
                  <div className="rounded bg-destructive-muted p-2 text-destructive">legacy blocked</div>
                </div>
              </div>
            </section>
            <section className="space-y-3">
              <MapColumnHeader icon={<PlugsConnected size={16}/>} title="Consumers" note="Exact assignment" />
              {['local-dev · Grant gen 8', 'invoice-worker · Registration gen 4', 'Gadget #0 · legacy'].map((consumer, index) => <div key={consumer} className="rounded-xl border border-border bg-background p-3 shadow-sm"><div className="text-xs font-medium">{consumer}</div><div className="mt-1 text-[11px] text-muted-foreground">{index === 0 ? 'lease independent from Grant' : index === 1 ? 'Service Binding assurance' : 'compatibility-only projection'}</div></div>)}
            </section>
          </div>
        </div>
      </div>
      <aside className="w-[430px] shrink-0 border-l border-border bg-background"><DecisionInspector decision={selected} scenario={state.scenario} onPreview={preview}/></aside>
    </div>
  )
}

function MapColumnHeader({ icon, title, note }: { icon: React.ReactNode; title: string; note: string }) {
  return <div className="flex items-center gap-2 px-1"><span className="text-primary">{icon}</span><div><div className="text-xs font-semibold">{title}</div><div className="text-[10px] text-muted-foreground">{note}</div></div></div>
}

const events = [
  ['842', 'op_4e21', 'Mat · manager gen 8', 'Artifact Approval decided', 'artifact sha256:11f9…8a2c'],
  ['843', 'op_4e21', 'Mat · manager gen 8', 'Installation Decision decided', 'consumer local-dev · STORAGE'],
  ['844', 'op_4e21', 'Workspace Authority · reconciler', 'Instance preparation requested', 'effect eff_91c2 · pending'],
  ['845', 'op_772b', 'Cloudflare adapter', 'Workload credential proved', 'registration gen 4'],
  ['846', 'op_772b', 'Workspace Authority · reconciler', 'Binding compare-and-swap committed', 'generation 41 → 42'],
  ['847', 'op_772b', 'Workspace Authority · cleanup', 'Provider cleanup retrying', 'responsibility retained'],
]

function VariantC({ state, select, preview }: VariantProps) {
  const selected = decisions.find((decision) => decision.id === state.selectedDecision) ?? decisions[0]
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="grid grid-cols-4 border-b border-border bg-card">
        {decisions.map((decision) => <button key={decision.id} type="button" onClick={() => select(decision.id)} className={`border-r border-border p-3 text-left last:border-r-0 ${state.selectedDecision === decision.id ? 'bg-selection-bg' : 'hover:bg-muted'}`}><div className="mb-1 flex items-center justify-between"><Mono>{decision.binding}</Mono><StatusPill decision={decision}/></div><div className="truncate text-xs font-medium">{decision.title}</div></button>)}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(560px,1fr)_430px]">
        <section className="min-h-0 overflow-y-auto border-r border-border p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div><h2 className="text-base font-semibold">Authority event ledger</h2><p className="mt-1 text-xs text-muted-foreground">Workspace sequence is causal order. Timestamps are display-only.</p></div>
            <div className="text-right text-[11px] text-muted-foreground">High-water mark <Mono>847</Mono><br/>page 1 · 6 of 6</div>
          </div>
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full border-collapse text-left text-[11px]">
              <thead className="bg-muted text-muted-foreground"><tr>{['Seq', 'Operation', 'Actor', 'Typed event', 'Subject / outcome'].map((header) => <th key={header} className="border-b border-border px-3 py-2 font-medium">{header}</th>)}</tr></thead>
              <tbody>{events.map((event, row) => <tr key={event[0]} className={row === 1 ? 'bg-selection-bg' : 'hover:bg-muted/40'}>{event.map((cell, index) => <td key={index} className="border-b border-border px-3 py-3 align-top last:border-b-0">{index < 2 ? <Mono>{cell}</Mono> : cell}</td>)}</tr>)}</tbody>
            </table>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div className="rounded-xl border border-border bg-card p-4"><div className="mb-2 flex items-center gap-2 text-xs font-semibold"><ClockCounterClockwise size={15}/> Legacy migration baseline</div><p className="text-[11px] text-muted-foreground">Actor: unknown · time: unknown · schema v3 · canonical digest <Mono>sha256:99af…01be</Mono>. No history was reconstructed.</p></div>
            <div className="rounded-xl border border-border bg-card p-4"><div className="mb-2 flex items-center gap-2 text-xs font-semibold"><WarningCircle size={15}/> Retention boundary</div><p className="text-[11px] text-muted-foreground">This ledger belongs to the workspace lifecycle. Workspace deletion is not a post-deletion compliance archive.</p></div>
          </div>
          <div className="mt-4 rounded-xl border border-border bg-background p-4 text-[11px] text-muted-foreground"><strong className="text-foreground">Separate evidence:</strong> Source Actions and operational retry logs are linked by Contract/Operation where safe, but are not Authority Events and do not appear in this sequence.</div>
        </section>
        <DecisionInspector decision={selected} scenario={state.scenario} onPreview={preview}/>
      </div>
    </div>
  )
}

function PrototypeSwitcher({ state, onVariant }: { state: PrototypeState; onVariant: (variant: AuthorityPrototypeVariant) => void }) {
  const currentIndex = variants.indexOf(state.variant)
  const cycle = (direction: -1 | 1) => onVariant(variants[(currentIndex + direction + variants.length) % variants.length])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.matches('input, textarea, [contenteditable="true"]')) return
      if (event.key === 'ArrowLeft') cycle(-1)
      if (event.key === 'ArrowRight') cycle(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (import.meta.env.PROD) return null
  return (
    <>
      <details className="fixed bottom-4 right-4 z-[120] w-[310px] rounded-xl border border-white/15 bg-zinc-950/95 text-white shadow-2xl backdrop-blur">
        <summary className="cursor-pointer px-3 py-2 text-[11px] font-medium">Prototype state</summary>
        <pre className="max-h-56 overflow-auto border-t border-white/10 p-3 text-[10px] leading-4 text-zinc-300">{JSON.stringify(state, null, 2)}</pre>
      </details>
      <div className="fixed bottom-4 left-1/2 z-[120] flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/15 bg-zinc-950 px-1.5 py-1.5 text-white shadow-2xl">
        <button type="button" aria-label="Previous variant" onClick={() => cycle(-1)} className="rounded-full p-2 hover:bg-white/10"><ArrowLeft size={15}/></button>
        <div className="min-w-[170px] px-3 text-center text-xs font-medium">{state.variant} — {variantNames[state.variant]}</div>
        <button type="button" aria-label="Next variant" onClick={() => cycle(1)} className="rounded-full p-2 hover:bg-white/10"><ArrowRight size={15}/></button>
      </div>
    </>
  )
}

export default function AuthorityReviewPrototype() {
  const search = useSearch({ from: '/authority-prototype' })
  const navigate = useNavigate({ from: '/authority-prototype' })
  const variant = search.variant ?? 'A'
  const [scenario, setScenario] = useState<Scenario>('reviewable')
  const [selectedDecision, setSelectedDecision] = useState<DecisionId>('storage')
  const [lastPreview, setLastPreview] = useState<string | null>(null)
  const state = useMemo<PrototypeState>(() => ({
    variant,
    scenario,
    selectedDecision,
    environment: 'Development',
    bindingSet: 'development@v7',
    authoritySession: 'owner · epoch 12',
    lastPreview,
  }), [variant, scenario, selectedDecision, lastPreview])

  const onVariant = (next: AuthorityPrototypeVariant) => {
    void navigate({ search: (previous) => ({ ...previous, variant: next }), replace: true })
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] min-h-0 flex-col overflow-hidden bg-background">
      <PageHeader scenario={scenario} onScenario={(value) => { setScenario(value); setLastPreview(null) }}/>
      {variant === 'A' && (
        <VariantA state={state} select={setSelectedDecision} preview={setLastPreview}/>
      )}
      {variant === 'B' && (
        <VariantB state={state} select={setSelectedDecision} preview={setLastPreview}/>
      )}
      {variant === 'C' && (
        <VariantC state={state} select={setSelectedDecision} preview={setLastPreview}/>
      )}
      <PrototypeSwitcher state={state} onVariant={onVariant}/>
    </div>
  )
}
