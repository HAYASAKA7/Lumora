import { acpProviderProfile } from '../acp/acp-provider-profiles';
import { createAcpStructuredAdapter } from './acp-structured-adapter';
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
  opencode(context: StructuredAgentAdapterContext): StructuredAgentAdapter;
  cursor(context: StructuredAgentAdapterContext): StructuredAgentAdapter;
  copilot(context: StructuredAgentAdapterContext): StructuredAgentAdapter;
  qwen(context: StructuredAgentAdapterContext): StructuredAgentAdapter;
  kimi(context: StructuredAgentAdapterContext): StructuredAgentAdapter;
  goose(context: StructuredAgentAdapterContext): StructuredAgentAdapter;
}

const defaultCreators: StructuredAgentAdapterCreators = {
  codex: createCodexStructuredAdapter,
  claude: createClaudeStructuredAdapter,
  gemini: createGeminiStructuredAdapter,
  opencode: (context) => createAcpStructuredAdapter(
    context,
    acpProviderProfile('opencode')
  ),
  cursor: (context) => createAcpStructuredAdapter(
    context,
    acpProviderProfile('cursor')
  ),
  copilot: (context) => createAcpStructuredAdapter(
    context,
    acpProviderProfile('copilot')
  ),
  qwen: (context) => createAcpStructuredAdapter(
    context,
    acpProviderProfile('qwen')
  ),
  kimi: (context) => createAcpStructuredAdapter(
    context,
    acpProviderProfile('kimi')
  ),
  goose: (context) => createAcpStructuredAdapter(
    context,
    acpProviderProfile('goose')
  )
};

export function createStructuredAgentAdapterFactory(
  creators: StructuredAgentAdapterCreators = defaultCreators
): CreateStructuredAgentAdapter {
  return async (context) => creators[context.providerId](context);
}
