import { afterAll, describe, expect, it } from 'vitest';
import {
  AgentStateManager,
  classifyVerificationCommand,
  type CompletionContractState
} from './agent-state-manager';
import { compactMessages, upsertPinnedTaskContext, type Message } from './context-compactor';
import { buildSessionSnapshot, sessionStore } from './session-store';

const PACKAGE_SCRIPTS = {
  'test:unit:main': 'vitest run --config vitest.main.config.ts',
  typecheck: 'tsc --noEmit',
  dev: 'node scripts/dev.mjs'
};

function implementationState(taskClass: CompletionContractState['taskClass'] = 'Medium'): AgentStateManager {
  const state = new AgentStateManager();
  state.initializeCompletionContract({
    originalObjective: 'Implement evidence-gated completion',
    taskClass,
    informational: false,
    packageScripts: PACKAGE_SCRIPTS
  });
  return state;
}

afterAll(() => {
  sessionStore.dispose();
});

describe('agent completion contract', () => {
  it('keeps simple informational answers exempt', () => {
    const state = new AgentStateManager();
    state.initializeCompletionContract({
      originalObjective: 'Explain closures',
      taskClass: 'Small',
      informational: true
    });

    expect(state.assessCompletion('A closure retains its lexical scope.')).toEqual({
      complete: true,
      unmetEvidence: []
    });
  });

  it('requires approval, completed todos, fresh verification, and a grounded summary', () => {
    const state = implementationState();
    const implementationTodo = state.addTodo('Implement the state gate');
    const verificationTodo = state.addTodo('Verify the focused tests');

    state.recordExplicitApproval(true);
    expect(state.recordSuccessfulEdit('replace_file_content', { filePath: 'src/main/agent/agent-state-manager.ts' })).toBe(true);
    expect(state.updateTodoFromTool(implementationTodo, 'replace_file_content', true)).toBe(true);
    expect(state.recordVerification('npm run test:unit:main', 'Exit Code: 0\nTests passed', true)).toBe(true);
    expect(state.updateTodoFromTool(verificationTodo, 'run_command', true, true)).toBe(true);

    const assessment = state.assessCompletion(
      'Changed src/main/agent/agent-state-manager.ts. Verification: npm run test:unit:main passed.'
    );
    expect(assessment).toEqual({ complete: true, unmetEvidence: [] });
  });

  it('invalidates successful verification after a later edit', () => {
    const state = implementationState();
    const todo = state.addTodo('Implement the state gate');
    state.recordExplicitApproval(true);
    state.recordSuccessfulEdit('write_file', { filePath: 'src/a.ts' });
    state.updateTodoFromTool(todo, 'write_file', true);
    state.recordVerification('npm run typecheck', 'Exit Code: 0', true);
    state.recordSuccessfulEdit('edit_file', { filePath: 'src/a.ts' });

    expect(state.assessCompletion('Changed src/a.ts; npm run typecheck passed.').unmetEvidence)
      .toContain('a successful real verification command');
  });

  it('classifies only discovered verification scripts or real verifier commands', () => {
    expect(classifyVerificationCommand('npm run test:unit:main', PACKAGE_SCRIPTS).isVerification).toBe(true);
    expect(classifyVerificationCommand('npm run typecheck', PACKAGE_SCRIPTS).isVerification).toBe(true);
    expect(classifyVerificationCommand('npm run dev', PACKAGE_SCRIPTS).isVerification).toBe(false);
    expect(classifyVerificationCommand('echo tests passed', PACKAGE_SCRIPTS).isVerification).toBe(false);
    expect(classifyVerificationCommand('npx vitest run src/main/agent/agent-completion-contract.test.ts', {}).isVerification).toBe(true);
  });

  it('bounds verification failures and continuation injections at three', () => {
    const state = implementationState();
    for (let index = 0; index < 5; index++) {
      state.recordVerification('npm run typecheck', `failure-${index}`, false);
    }
    const snapshot = state.getCompletionContractSnapshot();
    expect(snapshot?.verificationFailures).toHaveLength(3);
    expect(snapshot?.verificationFailures[0]).toContain('failure-2');

    expect(state.consumeContinuationInjection()).toBe(true);
    expect(state.consumeContinuationInjection()).toBe(true);
    expect(state.consumeContinuationInjection()).toBe(true);
    expect(state.consumeContinuationInjection()).toBe(false);
  });

  it('raises the iteration limit to 80 only after explicit Epic approval', () => {
    const epic = implementationState('Epic');
    expect(epic.maxIterations).toBe(70);
    epic.recordExplicitApproval(false);
    expect(epic.maxIterations).toBe(70);
    epic.recordExplicitApproval(true);
    expect(epic.maxIterations).toBe(80);

    const medium = implementationState('Medium');
    medium.recordExplicitApproval(true);
    expect(medium.maxIterations).toBe(70);
  });

  it('does not complete implementation todos from reads or failed edits', () => {
    const state = implementationState();
    const implementationTodo = state.addTodo('Implement the state gate');
    const discoveryTodo = state.addTodo('Inspect the current engine');

    expect(state.updateTodoFromTool(implementationTodo, 'read_file', true)).toBe(false);
    expect(state.updateTodoFromTool(implementationTodo, 'write_file', false)).toBe(false);
    expect(state.updateTodoFromTool(discoveryTodo, 'read_file', true)).toBe(true);
    expect(state.todos.find((todo) => todo.id === implementationTodo)?.status).toBe('pending');
  });

  it('pins the contract through compaction and session snapshots', () => {
    const state = implementationState('Epic');
    state.recordExplicitApproval(true);
    state.addTodo('Implement the state gate');
    state.recordSuccessfulEdit('write_file', { filePath: 'src/a.ts' });
    state.recordVerification('npm run typecheck', 'Exit Code: 0', true);
    const pinned = state.getPinnedTaskContext();
    const messages: Message[] = upsertPinnedTaskContext([
      { role: 'system', content: 'core' },
      { role: 'user', content: 'old request' },
      { role: 'assistant', content: 'old response' },
      { role: 'user', content: 'new request' }
    ], pinned);
    const compacted = compactMessages(messages, 'summary');

    expect(compacted[0].content).toContain('Original objective: Implement evidence-gated completion');
    expect(compacted[0].content).toContain('Task class: Epic');
    expect(compacted[0].content).toContain('npm run typecheck');

    const snapshot = buildSessionSnapshot('session-1', 'c:/workspace', {
      currentMode: 'execute',
      todos: state.todos,
      iterationCount: 5,
      toolCallHistory: [],
      completionContract: state.getCompletionContractSnapshot()
    });
    const resumed = new AgentStateManager();
    resumed.restoreTodos(snapshot.todos);
    resumed.restoreCompletionContract(snapshot.completionContract);

    expect(resumed.getCompletionContractSnapshot()?.originalObjective).toBe('Implement evidence-gated completion');
    expect(resumed.maxIterations).toBe(80);
    expect(resumed.getPinnedTaskContext()).toContain('Latest verification: PASS');
  });
});
