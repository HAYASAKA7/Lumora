import { z } from 'zod';

import { PlatformSchema } from './contracts';

export const REMOTE_HELPER_PROTOCOL_VERSION = 1 as const;
export const REMOTE_HELPER_MAX_CONTROL_FRAME_BYTES = 64 * 1024;

export const RemoteHelperCapabilitySchema = z.enum([
  'system-info',
  'provider-scan',
  'session-scan',
  'pty',
  'persistent-runtime'
]);

const RequestIdentitySchema = z.object({
  protocolVersion: z.literal(REMOTE_HELPER_PROTOCOL_VERSION),
  kind: z.literal('request'),
  generation: z.number().int().nonnegative().max(2_147_483_647),
  requestId: z.string().min(1).max(80).regex(/^[A-Za-z0-9._:-]+$/u)
}).strict();

const EmptyPayloadSchema = z.object({}).strict();

function requestSchema<Operation extends 'handshake' | 'system-info' | 'health' | 'shutdown'>(
  operation: Operation
) {
  return RequestIdentitySchema.extend({
    operation: z.literal(operation),
    payload: EmptyPayloadSchema
  }).strict();
}

export const RemoteHelperRequestSchema = z.discriminatedUnion('operation', [
  requestSchema('handshake'),
  requestSchema('system-info'),
  requestSchema('health'),
  requestSchema('shutdown')
]);

const ResponseIdentitySchema = z.object({
  protocolVersion: z.literal(REMOTE_HELPER_PROTOCOL_VERSION),
  kind: z.literal('response'),
  generation: z.number().int().nonnegative().max(2_147_483_647),
  requestId: z.string().min(1).max(80).regex(/^[A-Za-z0-9._:-]+$/u)
}).strict();

export const RemoteHelperSystemInfoSchema = z.object({
  helperVersion: z.string().min(1).max(40),
  protocolVersion: z.literal(REMOTE_HELPER_PROTOCOL_VERSION),
  platform: PlatformSchema,
  architecture: z.enum(['x64', 'arm64']),
  homeDirectory: z.string().min(1).max(4096),
  defaultShell: z.string().min(1).max(4096),
  capabilities: z.array(RemoteHelperCapabilitySchema).max(32)
}).strict();

export const RemoteHelperHandshakeResponseSchema = ResponseIdentitySchema.extend({
  operation: z.literal('handshake'),
  ok: z.literal(true),
  result: RemoteHelperSystemInfoSchema
}).strict();

export const RemoteHelperSystemInfoResponseSchema = ResponseIdentitySchema.extend({
  operation: z.literal('system-info'),
  ok: z.literal(true),
  result: RemoteHelperSystemInfoSchema
}).strict();

export const RemoteHelperHealthResponseSchema = ResponseIdentitySchema.extend({
  operation: z.literal('health'),
  ok: z.literal(true),
  result: z.object({ status: z.literal('ok') }).strict()
}).strict();

export const RemoteHelperShutdownResponseSchema = ResponseIdentitySchema.extend({
  operation: z.literal('shutdown'),
  ok: z.literal(true),
  result: z.object({ accepted: z.literal(true) }).strict()
}).strict();

export const RemoteHelperErrorResponseSchema = ResponseIdentitySchema.extend({
  operation: z.enum(['handshake', 'system-info', 'health', 'shutdown']),
  ok: z.literal(false),
  error: z.object({
    code: z.enum([
      'INVALID_REQUEST',
      'UNSUPPORTED_OPERATION',
      'INTERNAL_ERROR'
    ]),
    message: z.string().min(1).max(240)
  }).strict()
}).strict();

export const RemoteHelperResponseSchema = z.union([
  RemoteHelperHandshakeResponseSchema,
  RemoteHelperSystemInfoResponseSchema,
  RemoteHelperHealthResponseSchema,
  RemoteHelperShutdownResponseSchema,
  RemoteHelperErrorResponseSchema
]);

export type RemoteHelperCapability = z.infer<typeof RemoteHelperCapabilitySchema>;
export type RemoteHelperRequest = z.infer<typeof RemoteHelperRequestSchema>;
export type RemoteHelperResponse = z.infer<typeof RemoteHelperResponseSchema>;
export type RemoteHelperSystemInfo = z.infer<typeof RemoteHelperSystemInfoSchema>;
