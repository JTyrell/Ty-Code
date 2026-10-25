import { z } from 'zod';

export type WorkspaceCheckCategory =
  | 'existence'
  | 'quality'
  | 'grounding'
  | 'accuracy'
  | 'freshness'
  | 'bonus';

export interface WorkspaceCheck {
  id: string;
  name: string;
  category: WorkspaceCheckCategory;
  maxPoints: number;
  earnedPoints: number;
  passed: boolean;
  detail: string;
  suggestion?: string;
}

export interface WorkspaceCategoryScore {
  earned: number;
  max: number;
}

export interface WorkspaceGitInfo {
  isGitRepo: boolean;
  branch?: string;
  remoteUrl?: string;
  repoName?: string;
  isClean?: boolean;
  lastCommit?: string;
  commitsSinceConfigUpdate?: number;
}

export interface WorkspaceExistingConfigs {
  hasInstructions: boolean;
  instructionFiles: string[];
  rulesCount: number;
  skillsCount: number;
  mcpServersCount: number;
  docFiles: string[];
}

export interface WorkspaceCodeStats {
  totalFiles: number;
  sourceFiles: number;
  estimatedTokens: number;
}

export interface WorkspaceProfile {
  primaryLanguage: string;
  frameworks: string[]; // e.g., ['Next.js', 'Tailwind', 'tRPC']
  databases: string[];  // e.g., ['PostgreSQL', 'Redis']
  architecture: string; // e.g., 'Monorepo', 'Microservices', 'MVC'
  keyDirectories: Record<string, string>; // e.g., { 'components': 'src/components', 'api': 'src/app/api' }
  missingContext: string[]; // e.g., ['No testing framework detected', 'Missing DB schema']
  lastScanned: number;

  // Extended intelligence based on Caliber mechanics:
  readinessScore?: number;
  readinessGrade?: string;
  categoryScores?: Record<string, WorkspaceCategoryScore>;
  checks?: WorkspaceCheck[];
  gitInfo?: WorkspaceGitInfo;
  existingConfigs?: WorkspaceExistingConfigs;
  codeStats?: WorkspaceCodeStats;
  recommendedMCPs?: Array<{
    id: string;
    name: string;
    command: string;
    args: string[];
    disabled: boolean;
    description: string;
    trigger: string;
    category: string;
  }>;
}

export const WorkspaceCheckSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.enum(['existence', 'quality', 'grounding', 'accuracy', 'freshness', 'bonus']),
  maxPoints: z.number(),
  earnedPoints: z.number(),
  passed: z.boolean(),
  detail: z.string(),
  suggestion: z.string().optional()
});

export const WorkspaceCategoryScoreSchema = z.object({
  earned: z.number(),
  max: z.number()
});

export const WorkspaceGitInfoSchema = z.object({
  isGitRepo: z.boolean(),
  branch: z.string().optional(),
  remoteUrl: z.string().optional(),
  repoName: z.string().optional(),
  isClean: z.boolean().optional(),
  lastCommit: z.string().optional(),
  commitsSinceConfigUpdate: z.number().optional()
});

export const WorkspaceExistingConfigsSchema = z.object({
  hasInstructions: z.boolean(),
  instructionFiles: z.array(z.string()),
  rulesCount: z.number(),
  skillsCount: z.number(),
  mcpServersCount: z.number(),
  docFiles: z.array(z.string())
});

export const WorkspaceCodeStatsSchema = z.object({
  totalFiles: z.number(),
  sourceFiles: z.number(),
  estimatedTokens: z.number()
});

export const WorkspaceProfileSchema = z.object({
  primaryLanguage: z.string(),
  frameworks: z.array(z.string()),
  databases: z.array(z.string()),
  architecture: z.string(),
  keyDirectories: z.record(z.string(), z.string()),
  missingContext: z.array(z.string()),
  lastScanned: z.number(),

  readinessScore: z.number().optional(),
  readinessGrade: z.string().optional(),
  categoryScores: z.record(z.string(), WorkspaceCategoryScoreSchema).optional(),
  checks: z.array(WorkspaceCheckSchema).optional(),
  gitInfo: WorkspaceGitInfoSchema.optional(),
  existingConfigs: WorkspaceExistingConfigsSchema.optional(),
  codeStats: WorkspaceCodeStatsSchema.optional(),
  recommendedMCPs: z.array(z.any()).optional()
});
