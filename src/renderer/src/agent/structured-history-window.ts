import type { StructuredAgentTurnView } from './structured-agent-state';

export const structuredHistoryMaximumTurnsPerPage = 5;
export const structuredHistoryRenderBudget = 32 * 1024;

const baseTurnCost = 512;
const richBlockCost = 512;

function optionalTextCost(value: string | null): number {
  return value?.length ?? 0;
}

export function estimateStructuredTurnRenderCost(
  turn: StructuredAgentTurnView
): number {
  const reasoningCost = turn.reasoning.reduce(
    (total, text) => total + text.length + richBlockCost,
    0
  );
  const activityCost = turn.activities.reduce(
    (total, activity) => total + richBlockCost + activity.title.length +
      optionalTextCost(activity.detail) + optionalTextCost(activity.pathLabel),
    0
  );
  const diffCost = turn.diffs.reduce(
    (total, diff) => total + richBlockCost + diff.files.reduce(
      (fileTotal, file) => fileTotal + richBlockCost + file.pathLabel.length +
        optionalTextCost(file.oldPathLabel) + file.patch.length,
      0
    ),
    0
  );
  const approvalCost = turn.approvals.reduce(
    (total, approval) => total + richBlockCost + approval.title.length +
      approval.detail.length,
    0
  );
  const planCost = turn.plan.reduce(
    (total, item) => total + 128 + item.text.length,
    0
  );
  return baseTurnCost + turn.userText.length + turn.assistantText.length +
    reasoningCost + activityCost + diffCost + approvalCost + planCost;
}

export function nextStructuredHistoryVisibleCount(
  turns: readonly StructuredAgentTurnView[],
  currentVisibleCount: number
): number {
  const normalizedCurrent = Math.max(0, Math.min(turns.length, currentVisibleCount));
  const firstHiddenEnd = turns.length - normalizedCurrent;
  if (firstHiddenEnd === 0) return turns.length;

  let pageCost = 0;
  let pageTurnCount = 0;
  for (
    let index = firstHiddenEnd - 1;
    index >= 0 && pageTurnCount < structuredHistoryMaximumTurnsPerPage;
    index -= 1
  ) {
    const turnCost = estimateStructuredTurnRenderCost(turns[index]!);
    if (
      pageTurnCount > 0 &&
      pageCost + turnCost > structuredHistoryRenderBudget
    ) break;
    pageCost += turnCost;
    pageTurnCount += 1;
  }
  return normalizedCurrent + pageTurnCount;
}
