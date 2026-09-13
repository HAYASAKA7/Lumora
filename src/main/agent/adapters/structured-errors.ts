import type { StructuredAgentErrorKind } from '../../../shared/agent/contracts';

/**
 * What went wrong, in terms every agent shares. Each provider names its
 * failures its own way; the renderer says these kinds in the user's language
 * and keeps the provider's own words beneath as detail.
 */

type CodexErrorInfo = string | Record<string, unknown> | null | undefined;

/** Codex's `codexErrorInfo`: a bare name, or an object keyed by the name. */
export function codexErrorKind(info: CodexErrorInfo): StructuredAgentErrorKind {
  const name = typeof info === 'string'
    ? info
    : info !== null && typeof info === 'object' ? Object.keys(info)[0] ?? '' : '';
  switch (name) {
    case 'usageLimitExceeded':
    case 'sessionBudgetExceeded':
      return 'usage_limit';
    case 'rateLimitExceeded':
      return 'rate_limit';
    case 'contextWindowExceeded':
      return 'context_full';
    case 'serverOverloaded':
    case 'internalServerError':
      return 'overloaded';
    case 'httpConnectionFailed':
    case 'responseStreamConnectionFailed':
    case 'responseStreamDisconnected':
    case 'responseTooManyFailedAttempts':
      return 'connection';
    case 'unauthorized':
      return 'sign_in';
    case 'badRequest':
    case 'cyberPolicy':
    case 'misalignmentPolicyViolation':
      return 'rejected';
    default:
      return 'other';
  }
}

/** Claude's API error names, from a retry or a failed assistant message. */
export function claudeErrorKind(error: unknown): StructuredAgentErrorKind {
  switch (error) {
    case 'rate_limit':
      return 'rate_limit';
    case 'overloaded':
    case 'server_error':
      return 'overloaded';
    case 'authentication_failed':
    case 'oauth_org_not_allowed':
      return 'sign_in';
    case 'billing_error':
    case 'account_on_hold':
      return 'account';
    case 'invalid_request':
    case 'model_not_found':
      return 'rejected';
    default:
      return 'other';
  }
}

/** An HTTP status, when that is all a provider reports. */
export function httpStatusErrorKind(status: unknown): StructuredAgentErrorKind {
  if (typeof status !== 'number') return 'other';
  if (status === 429) return 'rate_limit';
  if (status === 401 || status === 403) return 'sign_in';
  if (status === 402) return 'account';
  if (status === 529 || status >= 500) return 'overloaded';
  if (status >= 400) return 'rejected';
  return 'other';
}

/**
 * A reset time in whole seconds since the epoch. Providers report seconds or
 * milliseconds; a value past the year 33658 in seconds can only be milliseconds.
 */
export function epochSeconds(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.floor(value > 1e12 ? value / 1_000 : value);
}

/** A provider's own words, cut to fit, or null when it gave none. */
export function providerWords(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text === '' ? null : text.slice(0, 1_024);
}
