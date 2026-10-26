import { ipcMain } from 'electron';
import type {
  CodeReviewRequest,
  CodeReviewRule,
  ConversationMemoryEntry,
  GenerateCodeRequest,
  InlineCompletionRequest,
  MemoryQuery,
  NaturalLanguageCommandRequest,
  PairProgrammingEvent,
  PairProgrammingSuggestion,
  ProjectContextQuery,
  RefactorRequest
} from '../../preload/types';
import { ProjectIndexer } from '../services/project-indexer';
import { ConversationMemoryService } from '../services/conversation-memory';
import { InlineCompletionService } from '../services/inline-completion-service';
import { AiCodeReviewService } from '../services/ai-code-review-service';
import { AiRefactorService } from '../services/ai-refactor-service';
import { NaturalLanguageService } from '../services/natural-language-service';
import { getWorkspaceEditPreviewService } from '../services/workspace-edit-preview';
import { getSettings } from './settings-handlers';

let projectIndexer: ProjectIndexer | null = null;
let memoryService: ConversationMemoryService | null = null;
let inlineService: InlineCompletionService | null = null;
let reviewService: AiCodeReviewService | null = null;
let refactorService: AiRefactorService | null = null;
let nlService: NaturalLanguageService | null = null;

export function initAiFeatureServices(workspacePath: string): {
  projectIndexer: ProjectIndexer;
  memoryService: ConversationMemoryService;
  inlineService: InlineCompletionService;
  reviewService: AiCodeReviewService;
  refactorService: AiRefactorService;
  nlService: NaturalLanguageService;
} {
  projectIndexer = new ProjectIndexer(workspacePath);
  memoryService = new ConversationMemoryService(workspacePath);
  inlineService = new InlineCompletionService(projectIndexer);
  reviewService = new AiCodeReviewService(workspacePath);
  refactorService = new AiRefactorService(workspacePath, getWorkspaceEditPreviewService());
  nlService = new NaturalLanguageService();

  return {
    projectIndexer,
    memoryService,
    inlineService,
    reviewService,
    refactorService,
    nlService
  };
}

export function getInlineService(): InlineCompletionService | null {
  return inlineService;
}

export function updateAiServicesWorkspace(workspacePath: string): void {
  projectIndexer?.setWorkspace(workspacePath);
  memoryService?.setWorkspace(workspacePath);
  reviewService?.setWorkspace(workspacePath);
  refactorService?.setWorkspace(workspacePath, getWorkspaceEditPreviewService());
}

export function registerAiFeatureHandlers(onProjectIndexed?: () => void): void {
  // 1. Inline AI Completions
  ipcMain.handle('ai:inline-completions', async (_event, req: InlineCompletionRequest) => {
    try {
      if (!inlineService) throw new Error('Inline completion service not initialized.');
      const res = await inlineService.getCompletions(req);
      return { success: true, data: res };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // 2. Project Indexing & Context
  ipcMain.handle('ai:index-project', async () => {
    try {
      if (!projectIndexer) throw new Error('Project indexer not initialized.');
      const stats = await projectIndexer.index();
      onProjectIndexed?.();
      return { success: true, data: stats };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('ai:get-project-index-stats', async () => {
    try {
      return { success: true, data: projectIndexer ? projectIndexer.getStats() : null };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('ai:query-project-context', async (_event, query: ProjectContextQuery) => {
    try {
      if (!projectIndexer) throw new Error('Project indexer not initialized.');
      const result = projectIndexer.queryContext(query);
      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // 3. AI Code Review
  ipcMain.handle('ai:run-code-review', async (_event, req: CodeReviewRequest) => {
    try {
      if (!reviewService) throw new Error('Code review service not initialized.');
      const result = await reviewService.review(req);
      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('ai:get-code-review-rules', async () => {
    try {
      if (!reviewService) throw new Error('Code review service not initialized.');
      const rules = await reviewService.loadRules();
      return { success: true, data: rules };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('ai:update-code-review-rules', async (_event, rules: CodeReviewRule[]) => {
    try {
      if (!reviewService) throw new Error('Code review service not initialized.');
      await reviewService.saveRules(rules);
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // 4. AI Refactoring
  ipcMain.handle('ai:request-refactor-preview', async (_event, req: RefactorRequest) => {
    try {
      if (!refactorService) throw new Error('Refactor service not initialized.');
      const result = await refactorService.previewRefactor(req);
      const settingsResponse = await getSettings();
      if (req.forcePreview !== true) {
        result.applied = await getWorkspaceEditPreviewService().tryAutoApplyPreview(result.preview.previewId, {
          enabled: settingsResponse.data?.['editor.reviewPolicy'] === 'autoApplySafeSingleFile',
          forcePreviewAll: false
        }) || undefined;
      }
      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // 5. Natural Language to Code & Commands
  ipcMain.handle('ai:generate-code', async (_event, req: GenerateCodeRequest) => {
    try {
      if (!nlService) throw new Error('Natural language service not initialized.');
      const result = await nlService.generateCode(req);
      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('ai:parse-nl-command', async (_event, req: NaturalLanguageCommandRequest) => {
    try {
      if (!nlService) throw new Error('Natural language service not initialized.');
      const result = await nlService.parseCommand(req);
      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // 6. Persistent Conversation Memory
  ipcMain.handle('ai:get-memories', async (_event, query?: MemoryQuery) => {
    try {
      if (!memoryService) throw new Error('Conversation memory service not initialized.');
      const data = await memoryService.queryMemories(query);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('ai:add-memory', async (_event, memory: Partial<ConversationMemoryEntry>) => {
    try {
      if (!memoryService) throw new Error('Conversation memory service not initialized.');
      const data = await memoryService.addMemory(memory);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // 7. AI Pair Programming Mode Suggestions
  ipcMain.handle('ai:pair-suggestions', async (_event, event: PairProgrammingEvent) => {
    try {
      const suggestions: PairProgrammingSuggestion[] = [];
      const lines = event.content.split('\n');
      const activeLine = lines[Math.max(0, event.line - 1)] || '';
      const trimmed = activeLine.trim();

      // Suggestion 1: Next Step after interface / type declaration
      if (/^(?:export\s+)?interface\s+([A-Za-z0-9_$]+)/.test(trimmed)) {
        const name = trimmed.match(/interface\s+([A-Za-z0-9_$]+)/)?.[1] || '';
        suggestions.push({
          id: `pair_${Date.now()}_1`,
          type: 'next-step',
          title: `Next step: Implement ${name} service or handler`,
          message: `You defined interface \`${name}\`. Consider writing the implementation factory or mock test data next.`,
          actionLabel: 'Create implementation'
        });
      }

      // Suggestion 2: Proactive Bug Alert (e.g. missing await)
      if (/\b(?:fetch|fs\.readFile)\s*\(/.test(activeLine) && !activeLine.includes('await')) {
        suggestions.push({
          id: `pair_${Date.now()}_2`,
          type: 'bug-alert',
          title: 'Async call missing `await`',
          message: 'Asynchronous I/O call without `await`. Execution will proceed before the Promise settles.',
          actionLabel: 'Add await'
        });
      }

      // Suggestion 3: Test-Driven Development (TDD) hint
      if (/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/.test(trimmed)) {
        const fnName = trimmed.match(/function\s+([A-Za-z0-9_$]+)/)?.[1] || '';
        suggestions.push({
          id: `pair_${Date.now()}_3`,
          type: 'tdd-step',
          title: `TDD: Write test for ${fnName}`,
          message: `In Pair Programming mode, let's write unit tests for \`${fnName}\` before completing implementation.`,
          actionLabel: 'Generate unit tests'
        });
      }

      return { success: true, data: suggestions };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });
}
