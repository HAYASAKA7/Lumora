import { z } from 'zod';

import {
  DeveloperToolStatusSchema,
  LifetimeTokenCountSchema,
  PlatformSchema,
  PROVIDER_IDS,
  ProviderIdSchema
} from './contracts';
import { SESSION_PROVIDER_IDS } from './provider-definitions';

export const REMOTE_HELPER_PROTOCOL_VERSION = 1 as const;
export const REMOTE_HELPER_MAX_CONTROL_FRAME_BYTES = 64 * 1024;

export const RemoteHelperCapabilitySchema = z.enum([
  'system-info',
  'provider-scan',
  'provider-lifecycle',
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
const SessionProviderIdSchema = ProviderIdSchema.refine(
  (provider) => SESSION_PROVIDER_IDS.includes(provider),
  'The provider does not expose a native session catalog.'
);
const SessionScanCursorSchema = z.string().regex(/^\d{1,10}$/u).nullable();

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
  requestSchema('shutdown'),
  RequestIdentitySchema.extend({
    operation: z.literal('discovery-scan'),
    payload: z.strictObject({
      enabledProviders: z.array(ProviderIdSchema)
        .min(1)
        .max(PROVIDER_IDS.length)
        .superRefine((providers, context) => {
          if (new Set(providers).size !== providers.length) {
            context.addIssue({
              code: 'custom', message: 'Enabled providers must be unique.'
            });
          }
      })
    })
  }).strict(),
  RequestIdentitySchema.extend({
    operation: z.literal('provider-lifecycle'),
    payload: z.strictObject({
      provider: ProviderIdSchema,
      action: z.enum(['install', 'update'])
    })
  }).strict(),
  RequestIdentitySchema.extend({
    operation: z.literal('session-scan'),
    payload: z.strictObject({
      provider: SessionProviderIdSchema,
      cursor: SessionScanCursorSchema,
      limit: z.number().int().min(1).max(100)
    })
  }).strict()
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

export const RemoteHelperProviderProbeSchema = z.discriminatedUnion('state', [
  z.strictObject({
    provider: ProviderIdSchema,
    state: z.literal('ready'),
    executablePath: z.string().min(1).max(4096),
    version: z.string().min(1).max(4096)
  }),
  z.strictObject({
    provider: ProviderIdSchema,
    state: z.literal('not_found'),
    executablePath: z.null(),
    version: z.null()
  }),
  z.strictObject({
    provider: ProviderIdSchema,
    state: z.literal('probe_failed'),
    executablePath: z.string().min(1).max(4096),
    version: z.null()
  })
]);

export const RemoteHelperDiscoveryResultSchema = z.strictObject({
  checkedAt: z.iso.datetime(),
  node: DeveloperToolStatusSchema,
  npm: DeveloperToolStatusSchema,
  providers: z.array(RemoteHelperProviderProbeSchema).max(PROVIDER_IDS.length)
});

export const RemoteHelperDiscoveryResponseSchema = ResponseIdentitySchema.extend({
  operation: z.literal('discovery-scan'),
  ok: z.literal(true),
  result: RemoteHelperDiscoveryResultSchema
}).strict();

export const RemoteHelperProviderLifecycleResultSchema = z.strictObject({
  provider: ProviderIdSchema,
  action: z.enum(['install', 'update']),
  completedAt: z.iso.datetime()
});

export const RemoteHelperProviderLifecycleResponseSchema =
  ResponseIdentitySchema.extend({
    operation: z.literal('provider-lifecycle'),
    ok: z.literal(true),
    result: RemoteHelperProviderLifecycleResultSchema
  }).strict();

export const RemoteHelperSessionRecordSchema = z.strictObject({
  nativeId: z.string().trim().min(1).max(256),
  workspacePath: z.string().min(1).max(32_768),
  title: z.string().trim().min(1).max(256),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  lifetimeTokens: LifetimeTokenCountSchema.nullable(),
  sourceKey: z.string().min(1).max(4_096)
});

export const RemoteHelperSessionScanResultSchema = z.discriminatedUnion('status', [
  z.strictObject({
    provider: SessionProviderIdSchema,
    scannedAt: z.iso.datetime(),
    status: z.literal('ready'),
    sessions: z.array(RemoteHelperSessionRecordSchema).max(100),
    invalidCount: z.number().int().nonnegative(),
    nextCursor: SessionScanCursorSchema
  }),
  z.strictObject({
    provider: SessionProviderIdSchema,
    scannedAt: z.iso.datetime(),
    status: z.literal('unsupported'),
    sessions: z.tuple([]),
    invalidCount: z.literal(0),
    nextCursor: z.null()
  }),
  z.strictObject({
    provider: SessionProviderIdSchema,
    scannedAt: z.iso.datetime(),
    status: z.literal('unavailable'),
    sessions: z.tuple([]),
    invalidCount: z.literal(0),
    nextCursor: z.null()
  }),
  z.strictObject({
    provider: SessionProviderIdSchema,
    scannedAt: z.iso.datetime(),
    status: z.literal('failed'),
    sessions: z.tuple([]),
    invalidCount: z.literal(0),
    nextCursor: z.null()
  })
]);

export const RemoteHelperSessionScanResponseSchema = ResponseIdentitySchema.extend({
  operation: z.literal('session-scan'),
  ok: z.literal(true),
  result: RemoteHelperSessionScanResultSchema
}).strict();

export const RemoteHelperErrorResponseSchema = ResponseIdentitySchema.extend({
  operation: z.enum([
    'handshake', 'system-info', 'health', 'shutdown', 'discovery-scan',
    'session-scan', 'provider-lifecycle'
  ]),
  ok: z.literal(false),
  error: z.object({
    code: z.enum([
      'INVALID_REQUEST',
      'UNSUPPORTED_OPERATION',
      'INTERNAL_ERROR',
      'PROVIDER_INSTALL_GUIDE_REQUIRED',
      'PROVIDER_PACKAGE_MANAGER_UNAVAILABLE',
      'PROVIDER_LIFECYCLE_FAILED',
      'PROVIDER_LIFECYCLE_TIMEOUT'
    ]),
    message: z.string().min(1).max(240)
  }).strict()
}).strict();

export const RemoteHelperResponseSchema = z.union([
  RemoteHelperHandshakeResponseSchema,
  RemoteHelperSystemInfoResponseSchema,
  RemoteHelperHealthResponseSchema,
  RemoteHelperShutdownResponseSchema,
  RemoteHelperDiscoveryResponseSchema,
  RemoteHelperProviderLifecycleResponseSchema,
  RemoteHelperSessionScanResponseSchema,
  RemoteHelperErrorResponseSchema
]);

export type RemoteHelperCapability = z.infer<typeof RemoteHelperCapabilitySchema>;
export type RemoteHelperRequest = z.infer<typeof RemoteHelperRequestSchema>;
export type RemoteHelperResponse = z.infer<typeof RemoteHelperResponseSchema>;
export type RemoteHelperSystemInfo = z.infer<typeof RemoteHelperSystemInfoSchema>;
export type RemoteHelperDiscoveryResult = z.infer<
  typeof RemoteHelperDiscoveryResultSchema
>;
export type RemoteHelperProviderLifecycleResult = z.infer<
  typeof RemoteHelperProviderLifecycleResultSchema
>;
export type RemoteHelperSessionRecord = z.infer<
  typeof RemoteHelperSessionRecordSchema
>;
export type RemoteHelperSessionScanResult = z.infer<
  typeof RemoteHelperSessionScanResultSchema
>;
