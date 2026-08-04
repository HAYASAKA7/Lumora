import {
  ExecutionTargetIdSchema,
  LumoraWindowContextSchema,
  type ExecutionTargetId,
  type LumoraWindowContext
} from '../../shared/contracts';

export interface ExecutionTargetGateway<Service> {
  register(executionTargetId: ExecutionTargetId, service: Service): void;
  resolve(context: LumoraWindowContext): Service;
}

export class ExecutionTargetGatewayError extends Error {
  readonly code = 'EXECUTION_TARGET_UNAVAILABLE';

  constructor(message: string) {
    super(message);
    this.name = 'ExecutionTargetGatewayError';
  }
}

export function createExecutionTargetGateway<Service>(): ExecutionTargetGateway<Service> {
  const services = new Map<ExecutionTargetId, Service>();

  return {
    register(input, service) {
      const executionTargetId = ExecutionTargetIdSchema.parse(input);
      if (services.has(executionTargetId)) {
        throw new ExecutionTargetGatewayError(
          `Execution target ${executionTargetId} is already registered.`
        );
      }
      services.set(executionTargetId, service);
    },

    resolve(input) {
      const context = LumoraWindowContextSchema.parse(input);
      const service = services.get(context.executionTargetId);
      if (service === undefined) {
        throw new ExecutionTargetGatewayError(
          `Execution target ${context.executionTargetId} is not available.`
        );
      }
      return service;
    }
  };
}
