import {useCallback, useEffect, useState} from "react";
import type {RpcStub} from "capnweb";
import type {AuthenticatedApi} from "@gadgets/workshop-shared/api";
import {
  hashAuthorityCommand,
  hashAuthorityRequest,
  type AgentTaskAuthorityView,
  type TaskTemplateAuthorityView,
} from "@gadgets/workshop-shared/authority-api";
import {Button} from "@matser/ui";

type Props = {
  authenticatedApi: RpcStub<AuthenticatedApi>;
  workspaceId: string;
};

/** Minimal auditable operator surface for current Agent Task authority. */
export function AgentTaskAuthorityPanel({authenticatedApi, workspaceId}: Props) {
  const [tasks, setTasks] = useState<readonly AgentTaskAuthorityView[]>([]);
  const [templates, setTemplates] = useState<readonly TaskTemplateAuthorityView[]>([]);
  const [error, setError] = useState<string>();
  const [busyTask, setBusyTask] = useState<string>();

  const load = useCallback(async () => {
    try {
      using authority = await authenticatedApi.openAuthority(workspaceId);
      const [nextTasks, nextTemplates] = await Promise.all([
        authority.listAgentTasks(),
        authority.listTaskTemplates(),
      ]);
      setTasks(nextTasks);
      setTemplates(nextTemplates);
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Task authority is unavailable.");
    }
  }, [authenticatedApi, workspaceId]);

  useEffect(() => { void load(); }, [load]);

  const cancel = async (task: AgentTaskAuthorityView) => {
    setBusyTask(task.taskId);
    try {
      using authority = await authenticatedApi.openAuthority(workspaceId);
      const snapshot = await authority.getSessionSnapshot();
      const intent = {
        type: "cancelAgentTask",
        taskId: task.taskId,
        taskGeneration: task.taskGeneration,
        environmentGeneration: task.environment.generation,
        ratchetVersion: task.environment.ratchetVersion,
      };
      const operation = await authority.beginOperation({
        idempotencyKey: `cancel-agent-task:${task.taskId}:${task.taskGeneration}`,
        requestDigest: await hashAuthorityRequest(intent),
      });
      const payload = {
        type: "cancelAgentTask" as const,
        operationId: operation.id,
        stepKey: "request-cancellation",
        expectedAuthorityEpoch: snapshot.authorityEpoch,
        expectedPermissionGeneration: snapshot.permissionGeneration,
        taskId: task.taskId,
        expectedTaskGeneration: task.taskGeneration,
        expectedEnvironmentGeneration: task.environment.generation,
        expectedRatchetVersion: task.environment.ratchetVersion,
      };
      await authority.execute({...payload, requestDigest: await hashAuthorityCommand(payload)});
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Cancellation request failed.");
    } finally {
      setBusyTask(undefined);
    }
  };

  return (
    <section aria-label="Agent Task authority" className="space-y-3 p-4 text-sm">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-medium text-foreground">Agent Tasks</h2>
          <p className="text-xs text-muted-foreground">Canonical authority and local enforcement state</p>
        </div>
        <Button variant="ghost" onClick={() => void load()}>Refresh</Button>
      </div>
      {error && <p role="alert" className="rounded-md bg-destructive/10 p-2 text-destructive">{error}</p>}
      <details className="rounded-xl border border-border bg-background p-3" open>
        <summary className="cursor-pointer font-medium text-foreground">Task Template governance</summary>
        <div className="mt-3 space-y-3">
          {templates.length === 0 && <p className="text-muted-foreground">No approved Task Templates.</p>}
          {templates.map(template => (
            <article key={template.approvalId} className="rounded-lg bg-muted p-3 text-xs">
              <h3 className="font-medium text-foreground">{template.id} v{template.version}</h3>
              <p>{template.approvalLifecycle} · approval {template.approvalId}</p>
              <p className="break-all font-mono">Ceiling: {template.ceilingDigest}</p>
              <p>Supersedes: {template.supersedesVersion ?? "None"}</p>
              <p>New dispatch: {template.newDispatchConsequence}</p>
              <p>Active tasks: {template.activeTaskConsequence}</p>
              <ul className="mt-2 list-disc pl-5">
                {template.requirements.map(requirement => (
                  <li key={requirement.requirementId}>
                    {requirement.name}: {requirement.artifactApprovalId}@
                    {requirement.artifactApprovalEpoch} · {requirement.authorityEnvelopeHash}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </details>
      {tasks.length === 0 && !error && <p className="text-muted-foreground">No Agent Tasks.</p>}
      {tasks.map(task => {
        const terminal = ["completed", "failed", "cancelled", "expired"].includes(task.lifecycle);
        return (
          <article key={task.taskId} className="rounded-xl border border-border bg-background p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-medium text-foreground">{task.taskId}</h3>
                <p className="text-xs text-muted-foreground">
                  {task.lifecycle} · workload {task.agentServiceWorkload.id}@
                  {task.agentServiceWorkload.generation} · principal {task.principal.id}
                </p>
              </div>
              <Button
                variant="ghost"
                disabled={terminal || busyTask === task.taskId || task.cancellation?.state === "requested"}
                onClick={() => void cancel(task)}
                aria-label={`Cancel Agent Task ${task.taskId}`}
                className="text-destructive"
              >
                {task.cancellation?.state === "requested" ? "Cancellation requested" : "Cancel task"}
              </Button>
            </div>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt>Template</dt><dd>{task.template.id} v{task.template.version} ({task.template.approvalLifecycle})</dd>
              <dt>Supersedes</dt><dd>{task.template.supersedesVersion ?? "None"}</dd>
              <dt>Ceiling</dt><dd className="break-all font-mono">{task.template.ceilingDigest}</dd>
              <dt>Artifact approvals</dt><dd>{task.template.artifactApprovals
                .map(approval => `${approval.id}@${approval.epoch}`).join(", ") || "None"}</dd>
              <dt>Lease</dt><dd>generation {task.lease.generation}, expires {new Date(task.lease.expiresAt).toLocaleString()}</dd>
              <dt>Environment</dt><dd>generation {task.environment.generation}, Ratchet {task.environment.ratchetVersion}</dd>
              <dt>Authority</dt><dd className="break-all font-mono">{task.environment.originalAuthorityDigest} → {task.environment.currentAuthorityDigest}</dd>
              <dt>Bindings</dt><dd>{task.environment.bindings.map(binding => binding.name).join(", ") || "None"}</dd>
              <dt>Authority debt</dt><dd>{task.authorityDebtRefs.join(", ") || "None"}</dd>
            </dl>
            {task.blocks.length > 0 && (
              <ul className="mt-3 list-disc pl-5 text-xs text-destructive">
                {task.blocks.map(block => <li key={`${block.type}:${block.reference}`}>{block.type}: {block.reference}</li>)}
              </ul>
            )}
            <details className="mt-3 text-xs">
              <summary className="cursor-pointer font-medium text-foreground">Evidence references</summary>
              <p>Authority Events: {task.evidence.authorityEvents.join(", ") || "None"}</p>
              <p>Source Activity: {task.evidence.sourceActivities.join(", ") || "None"}</p>
              <p>Agent Activity: {task.evidence.agentActivities.join(", ") || "None"}</p>
            </details>
          </article>
        );
      })}
    </section>
  );
}
