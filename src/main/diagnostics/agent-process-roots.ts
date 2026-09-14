import type { RuntimeSummary } from '../../shared/contracts';
import type { StructuredAgentProcess } from '../agent/runtime/structured-agent-runtime-host';
import {
  isActiveStructuredRuntime,
  isActiveTerminalRuntime
} from './active-terminal-count';
import type { AgentProcessRoot } from './diagnostic-process-details';

type TerminalRuntimeLike = Pick<RuntimeSummary, 'id' | 'provider' | 'displayName' | 'state' | 'pid'>;

/** The running agents on this computer, native terminal and unified interface alike. */
export function listAgentProcessRoots(
  terminal: readonly TerminalRuntimeLike[],
  structured: readonly StructuredAgentProcess[]
): AgentProcessRoot[] {
  return [
    ...terminal.filter(isActiveTerminalRuntime).map((runtime) => ({
      id: runtime.id,
      provider: runtime.provider,
      surface: 'terminal' as const,
      title: runtime.displayName,
      processId: runtime.pid,
      starting: runtime.state === 'launching'
    })),
    ...structured.filter(isActiveStructuredRuntime).map((runtime) => ({
      id: runtime.connectionId,
      provider: runtime.providerId,
      surface: 'unified' as const,
      title: runtime.title,
      processId: runtime.processId,
      starting: runtime.state === 'starting'
    }))
  ];
}
