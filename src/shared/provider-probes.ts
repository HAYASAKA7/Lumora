import { z } from 'zod';

import rawProviderProbes from './provider-probes.json';
import { PROVIDER_IDS, ProviderIdSchema, type ProviderId } from './contracts';

const ProviderProbeDefinitionSchema = z.strictObject({
  provider: ProviderIdSchema,
  command: z.string().regex(/^[A-Za-z0-9._-]+$/u).max(80),
  versionArgs: z.array(
    z.string().min(1).max(80).refine((value) => !/[\0\r\n]/u.test(value))
  ).min(1).max(4)
});

const ProviderProbeRegistrySchema = z.array(ProviderProbeDefinitionSchema)
  .length(PROVIDER_IDS.length)
  .superRefine((registry, context) => {
    const ids = registry.map(({ provider }) => provider);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', message: 'Provider probes must be unique.' });
    }
    if (ids.some((provider, index) => provider !== PROVIDER_IDS[index])) {
      context.addIssue({
        code: 'custom',
        message: 'Provider probes must use Lumora provider order.'
      });
    }
  });

export interface ProviderProbeDefinition {
  readonly provider: ProviderId;
  readonly command: string;
  readonly versionArgs: readonly string[];
}

export const PROVIDER_PROBES = Object.freeze(
  ProviderProbeRegistrySchema.parse(rawProviderProbes).map((probe) =>
    Object.freeze({ ...probe, versionArgs: Object.freeze([...probe.versionArgs]) })
  )
);

const PROBES_BY_ID = new Map<ProviderId, ProviderProbeDefinition>(
  PROVIDER_PROBES.map((probe) => [probe.provider, probe])
);

export function providerProbe(provider: ProviderId): ProviderProbeDefinition {
  return PROBES_BY_ID.get(provider) as ProviderProbeDefinition;
}
