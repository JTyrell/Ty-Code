/**
 * Task Classifier Service (Phase 6.4)
 *
 * Automatically inspects incoming user queries and classifies them by task type:
 * 1. complex_reasoning -> Tier S (Reasoning & Planning)
 * 2. code_generation  -> Tier A (Coding & Implementation)
 * 3. code_editing     -> Tier A (Surgical Edits & Refactoring)
 * 4. general_chat     -> Tier B (General Assistance & Q&A)
 * 5. quick_response   -> Tier C (Ultra-fast confirmations & short responses)
 *
 * Brand: Ty-Code
 */

import type {
  TaskType,
  TaskTypeDefinition,
  TaskClassificationResult
} from '../../../shared/types/model-router';
import type { ModelTier } from '../../../shared/types/free-providers';

export const TASK_DEFINITIONS: Record<TaskType, TaskTypeDefinition> = {
  complex_reasoning: {
    type: 'complex_reasoning',
    keywords: ['explain', 'analyze', 'why', 'how', 'plan', 'architect'],
    best_tier: 'tier_s_reasoning',
    description: 'Deep logical deduction, root-cause diagnosis, mathematical proof, or architectural blueprinting'
  },
  code_generation: {
    type: 'code_generation',
    keywords: ['write', 'create', 'implement', 'build', 'function', 'class'],
    best_tier: 'tier_a_coding',
    description: 'Generating new code, boilerplate, algorithms, full modules, or complete components'
  },
  code_editing: {
    type: 'code_editing',
    keywords: ['fix', 'refactor', 'update', 'change', 'modify'],
    best_tier: 'tier_a_coding',
    description: 'Surgical code changes, bug repairs, renaming, performance optimization, and syntax fixes'
  },
  general_chat: {
    type: 'general_chat',
    keywords: ['hello', 'help', 'question', 'tell me'],
    best_tier: 'tier_b_general',
    description: 'Conversational discourse, general questions, documentation summaries, and conceptual walkthroughs'
  },
  quick_response: {
    type: 'quick_response',
    keywords: ['yes', 'no', 'ok', 'thanks'],
    best_tier: 'tier_c_fast',
    description: 'Short acknowledgments, single-word approvals, quick queries, and brief confirmations'
  }
};

export class TaskClassifier {
  private static instance: TaskClassifier;

  public static getInstance(): TaskClassifier {
    if (!TaskClassifier.instance) {
      TaskClassifier.instance = new TaskClassifier();
    }
    return TaskClassifier.instance;
  }

  /**
   * Classifies a user query string into a specific task type and recommended model tier.
   */
  public classify(prompt: string, context?: { messageCount?: number; hasCodeContext?: boolean }): TaskClassificationResult {
    const rawTrimmed = prompt.trim();
    const lower = rawTrimmed.toLowerCase();
    const words = lower.split(/[\s,.;:!?()[\]{}"'`]+/).filter(Boolean);

    // 1. Quick response check (short inputs <= 4 words with confirmation/acknowledgement words)
    if (words.length <= 4) {
      const quickMatch = words.find((w) =>
        ['yes', 'no', 'ok', 'okay', 'thanks', 'thank', 'thx', 'sure', 'yep', 'nope', 'done', 'cool', 'got it'].includes(w)
      );
      if (quickMatch) {
        return {
          taskType: 'quick_response',
          bestTier: 'tier_c_fast',
          confidence: 0.98,
          matchedKeywords: [quickMatch],
          rationale: `Ultra-short acknowledgement ("${quickMatch}") detected; routed to Tier C Fast model for instant latency.`
        };
      }
    }

    // 2. Score all task types based on keyword occurrences, word boundaries, and semantic prefixes
    const scores: Record<TaskType, { score: number; matched: string[] }> = {
      complex_reasoning: { score: 0, matched: [] },
      code_generation: { score: 0, matched: [] },
      code_editing: { score: 0, matched: [] },
      general_chat: { score: 0, matched: [] },
      quick_response: { score: 0, matched: [] }
    };

    // Evaluate keywords for each task type
    for (const [taskType, def] of Object.entries(TASK_DEFINITIONS) as [TaskType, TaskTypeDefinition][]) {
      for (const kw of def.keywords) {
        const regex = new RegExp(`\\b${kw}\\b`, 'i');
        if (regex.test(lower)) {
          scores[taskType].score += 2;
          scores[taskType].matched.push(kw);
        }
      }
    }

    // Semantic Boosters for complex reasoning
    if (/\b(why does|how does|can you explain|analyze the|in-depth|tradeoffs|architecture|algorithm complexity|edge cases|step-by-step reasoning)\b/i.test(lower)) {
      scores.complex_reasoning.score += 3;
    }

    // Semantic Boosters for code editing
    if (/\b(bug|error|broken|fails|fixing|patch|refactor this|clean up|syntax error|type error|optimize this)\b/i.test(lower)) {
      scores.code_editing.score += 3;
    }

    // Semantic Boosters for code generation
    if (/\b(write a|create a|implement a|build a|generate a|new component|scaffold|code for)\b/i.test(lower)) {
      scores.code_generation.score += 3;
    }

    // Semantic Boosters for general chat
    if (/\b(hi|hello|hey|good morning|tell me about|what is|who are you|can you help)\b/i.test(lower)) {
      scores.general_chat.score += 2.5;
    }

    // Quick response keywords booster
    if (words.length <= 6 && /\b(yes|no|ok|thanks)\b/i.test(lower)) {
      scores.quick_response.score += 3;
    }

    // Find the highest scoring task type
    let bestTask: TaskType = 'general_chat';
    let highestScore = 0;

    for (const [type, item] of Object.entries(scores) as [TaskType, { score: number; matched: string[] }][]) {
      if (item.score > highestScore) {
        highestScore = item.score;
        bestTask = type;
      }
    }

    // If no keywords matched, use structural heuristics
    if (highestScore === 0) {
      if (lower.includes('{') || lower.includes('function') || lower.includes('=>') || lower.includes('class ') || context?.hasCodeContext) {
        bestTask = 'code_generation';
        highestScore = 1;
      } else if (words.length <= 3) {
        bestTask = 'quick_response';
        highestScore = 1;
      } else {
        bestTask = 'general_chat';
        highestScore = 1;
      }
    }

    const matchedKeywords = scores[bestTask].matched;
    const bestTier: ModelTier = TASK_DEFINITIONS[bestTask].best_tier;

    // Confidence calculation (capped at 0.98, minimum 0.70)
    const confidence = Math.min(0.98, Math.max(0.70, 0.70 + (highestScore * 0.05)));

    const rationale = matchedKeywords.length > 0
      ? `Detected keywords [${matchedKeywords.join(', ')}] indicating ${bestTask.replace('_', ' ')}; routed to ${bestTier}.`
      : `Structural analysis identified ${bestTask.replace('_', ' ')}; routed to ${bestTier}.`;

    return {
      taskType: bestTask,
      bestTier,
      confidence,
      matchedKeywords,
      rationale
    };
  }

  /**
   * Helper method to verify classification accuracy across an evaluation dataset.
   */
  public evaluateAccuracy(testDataset: Array<{ prompt: string; expectedTask: TaskType }>): { accuracy: number; total: number; correct: number } {
    let correct = 0;
    for (const test of testDataset) {
      const result = this.classify(test.prompt);
      if (result.taskType === test.expectedTask) {
        correct++;
      }
    }
    return {
      accuracy: testDataset.length > 0 ? (correct / testDataset.length) : 1.0,
      total: testDataset.length,
      correct
    };
  }
}

export const taskClassifier = TaskClassifier.getInstance();
