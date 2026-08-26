import type { ProviderId } from '../../../shared/contracts';

export type AgentRuntimeKind = 'pty' | 'structured';

export interface StructuredSessionClaim {
  ownerId: string;
  runtimeKind: AgentRuntimeKind;
  providerId: ProviderId;
  nativeSessionId: string | null;
}

export class StructuredSessionGuardError extends Error {
  readonly code = 'NATIVE_SESSION_ALREADY_ACTIVE';

  constructor() {
    super('This provider session is already active in Lumora.');
    this.name = 'StructuredSessionGuardError';
  }
}

function identityKey(
  providerId: ProviderId,
  nativeSessionId: string
): string {
  return `${providerId}\u0000${nativeSessionId}`;
}

export class StructuredSessionGuard {
  private readonly claimsByOwner = new Map<string, StructuredSessionClaim>();
  private readonly ownerByIdentity = new Map<string, string>();

  claim(claim: StructuredSessionClaim): void {
    const existingClaim = this.claimsByOwner.get(claim.ownerId);
    if (existingClaim !== undefined) {
      if (
        existingClaim.runtimeKind === claim.runtimeKind &&
        existingClaim.providerId === claim.providerId &&
        existingClaim.nativeSessionId === claim.nativeSessionId
      ) return;
      throw new StructuredSessionGuardError();
    }
    if (claim.nativeSessionId !== null) {
      this.assertAvailable(claim.providerId, claim.nativeSessionId, claim.ownerId);
      this.ownerByIdentity.set(
        identityKey(claim.providerId, claim.nativeSessionId),
        claim.ownerId
      );
    }
    this.claimsByOwner.set(claim.ownerId, { ...claim });
  }

  assignNativeSessionId(ownerId: string, nativeSessionId: string): void {
    const claim = this.claimsByOwner.get(ownerId);
    if (claim === undefined) {
      throw new Error('The structured session claim was not found.');
    }
    if (claim.nativeSessionId === nativeSessionId) return;
    if (claim.nativeSessionId !== null) {
      throw new StructuredSessionGuardError();
    }
    this.assertAvailable(claim.providerId, nativeSessionId, ownerId);
    this.ownerByIdentity.set(
      identityKey(claim.providerId, nativeSessionId),
      ownerId
    );
    this.claimsByOwner.set(ownerId, { ...claim, nativeSessionId });
  }

  release(ownerId: string): void {
    const claim = this.claimsByOwner.get(ownerId);
    if (claim === undefined) return;
    if (claim.nativeSessionId !== null) {
      const key = identityKey(claim.providerId, claim.nativeSessionId);
      if (this.ownerByIdentity.get(key) === ownerId) {
        this.ownerByIdentity.delete(key);
      }
    }
    this.claimsByOwner.delete(ownerId);
  }

  claimOf(ownerId: string): StructuredSessionClaim | null {
    const claim = this.claimsByOwner.get(ownerId);
    return claim === undefined ? null : { ...claim };
  }

  ownerOf(
    providerId: ProviderId,
    nativeSessionId: string
  ): Pick<StructuredSessionClaim, 'ownerId' | 'runtimeKind'> | null {
    const ownerId = this.ownerByIdentity.get(
      identityKey(providerId, nativeSessionId)
    );
    if (ownerId === undefined) return null;
    const claim = this.claimsByOwner.get(ownerId);
    if (claim === undefined) return null;
    return { ownerId, runtimeKind: claim.runtimeKind };
  }

  private assertAvailable(
    providerId: ProviderId,
    nativeSessionId: string,
    ownerId: string
  ): void {
    const existingOwner = this.ownerByIdentity.get(
      identityKey(providerId, nativeSessionId)
    );
    if (existingOwner !== undefined && existingOwner !== ownerId) {
      throw new StructuredSessionGuardError();
    }
  }
}
