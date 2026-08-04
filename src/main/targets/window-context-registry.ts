import {
  LumoraWindowContextSchema,
  type LumoraWindowContext
} from '../../shared/contracts';

export interface WindowContextRegistry {
  register(senderId: number, context: LumoraWindowContext): void;
  get(senderId: number): LumoraWindowContext | null;
  unregister(senderId: number): void;
}

export function createWindowContextRegistry(): WindowContextRegistry {
  const contexts = new Map<number, LumoraWindowContext>();

  return {
    register(senderId, input) {
      if (!Number.isSafeInteger(senderId) || senderId <= 0) {
        throw new Error('Window sender ID must be a positive safe integer.');
      }

      const context = LumoraWindowContextSchema.parse(input);
      const current = contexts.get(senderId);
      if (
        current !== undefined &&
        (current.mode !== context.mode ||
          current.executionTargetId !== context.executionTargetId)
      ) {
        throw new Error(
          'Window sender is already bound to another execution target.'
        );
      }

      contexts.set(senderId, Object.freeze({ ...context }));
    },

    get(senderId) {
      return contexts.get(senderId) ?? null;
    },

    unregister(senderId) {
      contexts.delete(senderId);
    }
  };
}
