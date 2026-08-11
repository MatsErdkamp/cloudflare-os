import {describe, expect, it, vi} from "vitest";

import {
  createConsumerEnvironmentAuthority,
  type CanonicalBindingEnvironment,
} from "../src/authority/consumer-environments.js";
import {makeMockStorage} from "./mock-storage.js";

function readyEnvironment(generation = 1): CanonicalBindingEnvironment {
  return {
    ready: true,
    generation,
    bindingSet: {id: "binding-set-1", version: 1},
    bindings: [{
      name: "FILES",
      required: true,
      bindingId: "binding-1",
      bindingGeneration: generation,
      contractInstanceId: "instance-1",
      contractInstanceGeneration: 1,
      artifactApprovalId: "approval-1",
      artifactApprovalEpoch: 1,
      publicTypes: "export interface Files { get(key: string): Promise<Uint8Array | null> }",
    }],
  };
}

describe("canonical Consumer environments", () => {
  it("leases one immutable Development Session snapshot and invalidates it wholesale", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    let environment = readyEnvironment();
    const authority = createConsumerEnvironmentAuthority(
      makeMockStorage(),
      () => structuredClone(environment),
    );
    authority.putDevelopmentGrant({
      id: "grant-1",
      principalId: "developer-1",
      generation: 1,
      projectId: "project-1",
      environmentId: "environment-1",
      bindingSet: {id: "binding-set-1", version: 1},
      consumerId: "consumer-development-1",
      consumerGeneration: 1,
      lifecycle: "active",
    });

    const session = authority.startDevelopmentSession({
      operationId: "start-1",
      principalId: "developer-1",
      grantId: "grant-1",
      expectedGrantGeneration: 1,
      expectedBindingSet: {id: "binding-set-1", version: 1},
    });
    const replay = authority.startDevelopmentSession({
      operationId: "start-1",
      principalId: "developer-1",
      grantId: "grant-1",
      expectedGrantGeneration: 1,
      expectedBindingSet: {id: "binding-set-1", version: 1},
    });
    expect(replay.id).toBe(session.id);

    const snapshot = authority.openDevelopmentEnvironment(
      session.id,
      "developer-1",
      session.environmentGeneration,
    );
    expect(snapshot.bindings.map(binding => binding.name)).toEqual(["FILES"]);
    expect(authority.validateEnvironmentSnapshot(snapshot)).toBe(true);

    const renewed = authority.renewDevelopmentSession({
      operationId: "renew-1",
      sessionId: session.id,
      principalId: "developer-1",
      expectedConsumerGeneration: 1,
      expectedLeaseGeneration: 1,
    });
    expect(renewed.leaseGeneration).toBe(2);
    expect(authority.validateEnvironmentSnapshot(snapshot)).toBe(false);

    const fresh = authority.openDevelopmentEnvironment(
      session.id,
      "developer-1",
      renewed.environmentGeneration,
    );
    environment = readyEnvironment(2);
    expect(authority.validateEnvironmentSnapshot(fresh)).toBe(false);

    const renewedAgain = authority.renewDevelopmentSession({
      operationId: "renew-2",
      sessionId: session.id,
      principalId: "developer-1",
      expectedConsumerGeneration: 1,
      expectedLeaseGeneration: 2,
    });
    const current = authority.openDevelopmentEnvironment(
      session.id,
      "developer-1",
      renewedAgain.environmentGeneration,
    );
    authority.disconnectDevelopmentSession({
      operationId: "disconnect-1",
      sessionId: session.id,
      principalId: "developer-1",
      expectedConsumerGeneration: 1,
    });
    expect(authority.validateEnvironmentSnapshot(current)).toBe(false);

    const expiring = authority.startDevelopmentSession({
      operationId: "start-2",
      principalId: "developer-1",
      grantId: "grant-1",
      expectedGrantGeneration: 1,
      expectedBindingSet: {id: "binding-set-1", version: 1},
    });
    vi.setSystemTime(expiring.expiresAt + 1);
    expect(authority.nextDevelopmentExpiryAt()).toBe(expiring.expiresAt);
    expect(authority.getDueDevelopmentSessions(Date.now()).map(item => item.sessionId))
      .toContain(expiring.id);
    expect(() => authority.resumeDevelopmentSession({
      sessionId: expiring.id,
      principalId: "developer-1",
      expectedConsumerGeneration: 1,
    })).toThrow("expired");
    authority.expireDevelopmentSession({
      operationId: "expire-1",
      sessionId: expiring.id,
      expectedConsumerGeneration: 1,
    });
    expect(authority.getDevelopmentSessionStatus(expiring.id, "developer-1").lifecycle)
      .toBe("expired");
    vi.useRealTimers();
  });

  it("authenticates a Workload attachment without letting evidence select authority", () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000);
    const authority = createConsumerEnvironmentAuthority(
      makeMockStorage(),
      () => readyEnvironment(),
    );
    authority.putWorkload({
      id: "workload-1",
      consumerId: "consumer-workload-1",
      consumerGeneration: 1,
      projectId: "project-1",
      environmentId: "environment-1",
      bindingSet: {id: "binding-set-1", version: 1},
      generation: 1,
      lifecycle: "active",
      agentService: {profileId: "agent-service-1", role: "manager"},
    });
    authority.putWorkloadRegistration({
      id: "registration-1",
      workloadId: "workload-1",
      adapterId: "cloudflare-service-binding.v1",
      issuer: "cloudflare-account:account-1",
      credentialSubject: "subject-1",
      credentialGeneration: 1,
      generation: 1,
      lifecycle: "active",
    });

    const attachment = authority.attachWorkload({
      registrationId: "registration-1",
      evidence: {
        adapterId: "cloudflare-service-binding.v1",
        issuer: "cloudflare-account:account-1",
        subject: "subject-1",
        credentialGeneration: 1,
        authenticatedAt: 2_000,
        expiresAt: 20_000,
        auditFingerprint: "fingerprint-1",
      },
    });
    const snapshot = authority.openWorkloadEnvironment(
      attachment,
      attachment.environmentGeneration,
    );
    expect(snapshot.consumerId).toBe("consumer-workload-1");
    expect(authority.validateEnvironmentSnapshot(snapshot)).toBe(true);

    authority.rotateWorkloadCredential({
      operationId: "rotate-1",
      registrationId: "registration-1",
      expectedGeneration: 1,
      credentialSubject: "subject-2",
      credentialGeneration: 2,
    });
    expect(authority.validateEnvironmentSnapshot(snapshot)).toBe(true);
    expect(() => authority.attachWorkload({
      registrationId: "registration-1",
      evidence: {
        adapterId: "cloudflare-service-binding.v1",
        issuer: "cloudflare-account:account-1",
        subject: "subject-1",
        credentialGeneration: 1,
        authenticatedAt: 2_000,
        expiresAt: 20_000,
        auditFingerprint: "fingerprint-1",
      },
    })).not.toThrow();

    const rotatedAttachment = authority.attachWorkload({
      registrationId: "registration-1",
      evidence: {
        adapterId: "cloudflare-service-binding.v1",
        issuer: "cloudflare-account:account-1",
        subject: "subject-2",
        credentialGeneration: 2,
        authenticatedAt: 2_000,
        expiresAt: 20_000,
        auditFingerprint: "fingerprint-2",
      },
    });
    expect(rotatedAttachment.registrationGeneration).toBe(1);
    authority.finalizeWorkloadCredentialRotation({
      operationId: "finalize-1",
      registrationId: "registration-1",
      expectedGeneration: 1,
      expectedCredentialGeneration: 2,
    });
    expect(authority.validateEnvironmentSnapshot(snapshot)).toBe(false);
    expect(() => authority.attachWorkload({
      registrationId: "registration-1",
      evidence: {
        adapterId: "cloudflare-service-binding.v1",
        issuer: "cloudflare-account:account-1",
        subject: "subject-1",
        credentialGeneration: 1,
        authenticatedAt: 2_000,
        expiresAt: 20_000,
        auditFingerprint: "fingerprint-1",
      },
    })).toThrow("denied");
    const currentAttachment = authority.attachWorkload({
      registrationId: "registration-1",
      evidence: {
        adapterId: "cloudflare-service-binding.v1",
        issuer: "cloudflare-account:account-1",
        subject: "subject-2",
        credentialGeneration: 2,
        authenticatedAt: 2_000,
        expiresAt: 20_000,
        auditFingerprint: "fingerprint-2",
      },
    });
    const rotatedSnapshot = authority.openWorkloadEnvironment(
      currentAttachment,
      currentAttachment.environmentGeneration,
    );
    authority.transitionWorkload("workload-1", 1, "suspended");
    expect(authority.validateEnvironmentSnapshot(rotatedSnapshot)).toBe(false);
    vi.useRealTimers();
  });
});
