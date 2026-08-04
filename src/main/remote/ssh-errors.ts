export type RemoteSshErrorCode =
  | 'AUTHENTICATION_MISMATCH'
  | 'AUTHENTICATION_FAILED'
  | 'HOST_KEY_CHANGED'
  | 'HOST_KEY_UNAVAILABLE'
  | 'SSH_AGENT_UNAVAILABLE'
  | 'SSH_CONNECTION_FAILED'
  | 'SSH_TIMEOUT'
  | 'SSH_OUTPUT_LIMIT';

export class RemoteSshError extends Error {
  constructor(
    readonly code: RemoteSshErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'RemoteSshError';
  }
}
