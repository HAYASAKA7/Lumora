import type { DatabaseSync } from 'node:sqlite';

import {
  EnabledProviderIdsSchema,
  RemoteExecutionTargetIdSchema,
  type ProviderId,
  type RemoteExecutionTargetId
} from '../../shared/contracts';
import { GeneralSettingsStorage } from './general-settings-storage';

export class RemoteProviderPreferenceRepository {
  constructor(private readonly database: DatabaseSync) {}

  get(input: RemoteExecutionTargetId): ProviderId[] {
    const executionTargetId = RemoteExecutionTargetIdSchema.parse(input);
    return [
      ...new GeneralSettingsStorage(this.database, executionTargetId)
        .get().enabledProviders
    ];
  }

  save(
    input: RemoteExecutionTargetId,
    enabledProviders: readonly ProviderId[],
    now = new Date()
  ): ProviderId[] {
    const executionTargetId = RemoteExecutionTargetIdSchema.parse(input);
    const providers = EnabledProviderIdsSchema.parse([...enabledProviders]);
    const storage = new GeneralSettingsStorage(this.database, executionTargetId);
    const current = storage.get();
    return [...storage.save({
      ...current,
      enabledProviders: providers
    }, now.toISOString()).enabledProviders];
  }
}
