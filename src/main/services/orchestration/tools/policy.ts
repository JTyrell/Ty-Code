import { randomUUID } from 'node:crypto';
import type { AgentToolApproval, ToolCall } from '../../../../preload/types';
import type { FileMutationReview } from '../../security-policy';
import type { ToolContext, ToolExecutionResult } from './types';

function makeApproval(tool: ToolCall, reason: string, fileReview?: FileMutationReview): AgentToolApproval {
  return {
    id: `approval_${randomUUID()}`,
    toolCall: tool,
    reason,
    ...(fileReview ? {
      affectedPaths: [fileReview.filePath],
      reviewDiff: {
        id: `review_${tool.id}`,
        filePath: fileReview.filePath,
        originalContent: fileReview.originalContent,
        proposedContent: fileReview.proposedContent,
        description: `Review changes proposed by ${tool.name}`,
        status: 'pending' as const
      },
      addedLines: fileReview.addedLines,
      removedLines: fileReview.removedLines
    } : {})
  };
}

export async function approveFileMutation(
  tool: ToolCall,
  filePath: string,
  originalContent: string,
  proposedContent: string,
  context: ToolContext
): Promise<{ review?: FileMutationReview; absolutePath?: string; denied?: ToolExecutionResult }> {
  if (!context.securityPolicy) return {};
  const review = await context.securityPolicy.createFileMutationReview(filePath, proposedContent);
  if (review.originalContent !== originalContent) {
    return { denied: { output: `File ${filePath} changed before the edit could be reviewed. Read the latest content and try again.`, isError: true } };
  }

  const decision = await context.securityPolicy.evaluateFileMutation(review);
  if (decision.decision === 'block') {
    return { denied: { output: `Blocked by security policy: ${decision.reason}`, isError: true } };
  }
  if (decision.decision === 'ask') {
    const approved = await context.requestApproval?.(makeApproval(tool, decision.reason, review));
    if (!approved) {
      return { denied: { output: 'The user did not approve this file change. It was not applied.', isError: true } };
    }
  }
  if (context.abortSignal?.aborted) {
    return { denied: { output: 'File change cancelled.', isError: true } };
  }
  const absolutePath = await context.securityPolicy.verifyFileMutationSnapshot(review);
  return { review, absolutePath };
}

export async function approveTerminalCommand(
  command: string,
  requestedCwd: string | undefined,
  context: ToolContext,
  forceAsk = false
): Promise<{ cwd?: string; denied?: ToolExecutionResult }> {
  if (!context.securityPolicy) {
    if (!forceAsk) return {};
    const tool: ToolCall = { id: `call_${randomUUID()}`, name: 'bash', arguments: { command } };
    const approved = await context.requestApproval?.(makeApproval(tool, 'Plan Agent requires explicit user confirmation before executing shell commands.'));
    return approved ? {} : { denied: { output: 'The user did not approve this command. It was not executed.', isError: true } };
  }

  let decision = await context.securityPolicy.evaluateTerminalCommand(command);
  if (forceAsk && decision.decision !== 'block') {
    decision = { decision: 'ask', reason: 'Plan Agent requires explicit user confirmation before executing shell commands.' };
  }
  if (decision.decision === 'block') {
    return { denied: { output: `Blocked by security policy: ${decision.reason}`, isError: true } };
  }

  let approvalGranted = false;
  if (decision.decision === 'ask') {
    const tool: ToolCall = {
      id: `call_${randomUUID()}`,
      name: 'bash',
      arguments: { command, cwd: requestedCwd }
    };
    approvalGranted = Boolean(await context.requestApproval?.(makeApproval(tool, decision.reason)));
    if (!approvalGranted) {
      return { denied: { output: 'The user did not approve this command. It was not executed.', isError: true } };
    }
  }

  if (context.abortSignal?.aborted) {
    return { denied: { output: 'Command execution cancelled.', isError: true } };
  }
  const currentDecision = await context.securityPolicy.evaluateTerminalCommand(command);
  if (currentDecision.decision === 'block' || (currentDecision.decision === 'ask' && !approvalGranted)) {
    return { denied: { output: `Blocked by updated security policy: ${currentDecision.reason}`, isError: true } };
  }
  const cwd = await context.securityPolicy.resolveFilePath(requestedCwd || context.workspaceRoot, false);
  return { cwd };
}
