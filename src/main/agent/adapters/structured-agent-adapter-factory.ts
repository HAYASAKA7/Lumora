import { createClaudeStructuredAdapter } from './claude-structured-adapter';
import { createCodexStructuredAdapter } from './codex-structured-adapter';
import { createGeminiStructuredAdapter } from './gemini-structured-adapter';
import type {
  CreateStructuredAgentAdapter,
  StructuredAgentAdapter,
  StructuredAgentAdapterContext
} from './structured-agent-adapter';

export interface StructuredAgentAdapterCreators {
  codex(context: StructuredAgentAdapterContext): StructuredAgentAdapter;
  claude(context: StructuredAgentAdapterContext): StructuredAgentAdapter;
  gemini(context: StructuredAgentAdapterContext): StructuredAgentAdapter;
}

const defaultCreators: StructuredAgentAdapterCreators = {
  codex: createCodexStructuredAdapter,
  claude: createClaudeStructuredAdapter,
  gemini: createGeminiStructuredAdapter
};

export function createStructuredAgentAdapterFactory(
  creators: StructuredAgentAdapterCreators = defaultCreators
): CreateStructuredAgentAdapter {
  return async (context) => creators[context.providerId](context);
}
