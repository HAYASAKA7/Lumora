import { z } from 'zod';

export const REMOTE_TARGET_ERROR_CODES = [
  'REMOTE_TARGET_AUTHENTICATION_FAILED',
  'REMOTE_TARGET_HOST_KEY_CHANGED',
  'REMOTE_TARGET_SSH_TIMEOUT',
  'REMOTE_TARGET_SSH_CONNECTION_FAILED',
  'REMOTE_TARGET_PLATFORM_PROBE_FAILED',
  'REMOTE_TARGET_HELPER_BUNDLE_FAILED',
  'REMOTE_TARGET_FILE_TRANSFER_FAILED',
  'REMOTE_TARGET_HELPER_INSPECTION_FAILED',
  'REMOTE_TARGET_OPERATION_FAILED'
] as const;

export const RemoteTargetErrorCodeSchema = z.enum(REMOTE_TARGET_ERROR_CODES);

export type RemoteTargetErrorCode = z.infer<
  typeof RemoteTargetErrorCodeSchema
>;

export function readRemoteTargetErrorCode(
  error: unknown
): RemoteTargetErrorCode {
  if (typeof error !== 'object' || error === null) {
    return 'REMOTE_TARGET_OPERATION_FAILED';
  }

  if ('code' in error) {
    const parsedCode = RemoteTargetErrorCodeSchema.safeParse(error.code);
    if (parsedCode.success) return parsedCode.data;
  }

  const message = 'message' in error && typeof error.message === 'string'
    ? error.message
    : '';
  const publicMessage = ': Lumora could not complete the remote-target operation.';
  for (const code of REMOTE_TARGET_ERROR_CODES) {
    if (message.includes(`${code}${publicMessage}`)) return code;
  }
  return 'REMOTE_TARGET_OPERATION_FAILED';
}
