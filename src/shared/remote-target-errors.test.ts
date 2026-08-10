import { describe, expect, it } from 'vitest';

import {
  REMOTE_TARGET_ERROR_CODES,
  RemoteTargetErrorCodeSchema,
  readRemoteTargetErrorCode
} from './remote-target-errors';

describe('remote target error contract', () => {
  it('accepts only the bounded public remote-target failure codes', () => {
    expect(REMOTE_TARGET_ERROR_CODES).toEqual([
      'REMOTE_TARGET_AUTHENTICATION_FAILED',
      'REMOTE_TARGET_HOST_KEY_CHANGED',
      'REMOTE_TARGET_SSH_TIMEOUT',
      'REMOTE_TARGET_SSH_CONNECTION_FAILED',
      'REMOTE_TARGET_PLATFORM_PROBE_FAILED',
      'REMOTE_TARGET_HELPER_BUNDLE_FAILED',
      'REMOTE_TARGET_FILE_TRANSFER_FAILED',
      'REMOTE_TARGET_HELPER_INSPECTION_FAILED',
      'REMOTE_TARGET_OPERATION_FAILED'
    ]);
    for (const code of REMOTE_TARGET_ERROR_CODES) {
      expect(RemoteTargetErrorCodeSchema.parse(code)).toBe(code);
    }
    expect(RemoteTargetErrorCodeSchema.safeParse('PRIVATE_REMOTE_PATH').success)
      .toBe(false);
  });

  it('recovers a safe code from Electron-serialized error messages', () => {
    expect(readRemoteTargetErrorCode(new Error(
      'REMOTE_TARGET_PLATFORM_PROBE_FAILED: Lumora could not complete the remote-target operation.'
    ))).toBe('REMOTE_TARGET_PLATFORM_PROBE_FAILED');
    expect(readRemoteTargetErrorCode(Object.assign(new Error('safe'), {
      code: 'REMOTE_TARGET_SSH_TIMEOUT'
    }))).toBe('REMOTE_TARGET_SSH_TIMEOUT');
    expect(readRemoteTargetErrorCode(new Error(
      'PRIVATE_REMOTE_PATH: /private/remote/path'
    ))).toBe('REMOTE_TARGET_OPERATION_FAILED');
  });

  it('recovers a safe code from Electron invoke error wrapping', () => {
    expect(readRemoteTargetErrorCode(new Error(
      "Error invoking remote method 'lumora:targets:connect': Error: " +
      'REMOTE_TARGET_AUTHENTICATION_FAILED: Lumora could not complete the remote-target operation.'
    ))).toBe('REMOTE_TARGET_AUTHENTICATION_FAILED');
  });
});
