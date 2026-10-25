/**
 * Ty-Code Context Engine: Context Audit Scorer (Step 1)
 *
 * Evaluates how completely the engine understands the workspace stack
 * and computes a deterministic Context Audit Score (0 - 100).
 *
 * Scoring criteria:
 * - +20: Detecting primary language / frameworks
 * - +20: Detecting database schema / migrations
 * - +20: Finding test files / testing framework
 * - +20: Finding CI/CD or Docker / container configs
 * - +20: Having at least 5 user-defined Correction Memories (proportional up to 20)
 * - Deductions: Deduct points for items in `missingContext` (e.g., "No testing framework detected")
 *
 * 100% Local (Zero-Telemetry guarantee).
 */

import type { WorkspaceProfile } from './types';
import { getOrScanWorkspaceProfile } from './workspace-scanner';
import { getCorrectionEntries } from './correction-memory';

export interface ContextScoreCategory {
  score: number;
  max: number;
  passed: boolean;
  details: string;
}

export interface ContextScoreBreakdown {
  languageAndFrameworks: ContextScoreCategory;
  databaseSchema: ContextScoreCategory;
  testFiles: ContextScoreCategory;
  ciCdOrDocker: ContextScoreCategory;
  correctionMemories: ContextScoreCategory & { count: number };
  missingContextPenalties: { penalty: number; items: string[] };
}

export interface ContextScoreResult {
  score: number; // 0 - 100
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  rawScore: number;
  totalPenalty: number;
  breakdown: ContextScoreBreakdown;
  detectedStack: {
    primaryLanguage: string;
    frameworks: string[];
    databases: string[];
    architecture: string;
    keyDirectories: Record<string, string>;
  };
  missingContext: string[];
  recommendations: string[];
  lastCalculated: number;
}

/**
 * Computes letter grade based on audit score.
 */
export function computeGrade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

/**
 * Calculates the Context Audit Score for a given WorkspaceProfile and count of Correction Memories.
 */
export function calculateContextScore(
  profile: WorkspaceProfile,
  correctionsCount: number = 0
): ContextScoreResult {
  const missingContext = Array.isArray(profile.missingContext) ? profile.missingContext : [];
  const recommendations: string[] = [];

  // 1. Language & Frameworks (+20)
  const hasLang = Boolean(profile.primaryLanguage && profile.primaryLanguage.toLowerCase() !== 'unknown');
  const hasFrameworks = Array.isArray(profile.frameworks) && profile.frameworks.length > 0;

  let langScore = 0;
  let langDetails = 'No language or frameworks detected.';
  if (hasLang && hasFrameworks) {
    langScore = 20;
    langDetails = `Primary language: ${profile.primaryLanguage}, Frameworks: ${profile.frameworks.join(', ')}`;
  } else if (hasLang) {
    langScore = 10;
    langDetails = `Primary language: ${profile.primaryLanguage} (no frameworks detected)`;
    recommendations.push('Specify or document main libraries/frameworks to improve context fidelity.');
  } else if (hasFrameworks) {
    langScore = 10;
    langDetails = `Frameworks: ${profile.frameworks.join(', ')} (primary language unknown)`;
  } else {
    recommendations.push('Add project manifest (package.json, pyproject.toml, Cargo.toml) for stack detection.');
  }

  // 2. Database Schema (+20)
  const hasDatabases = Array.isArray(profile.databases) && profile.databases.length > 0;
  const hasDbMissingWarning = missingContext.some((m) =>
    /without schema|missing db schema|database detected without schema/i.test(m)
  );
  const hasDbChecksPassed = Boolean(profile.checks?.some((c) => c.id === 'db_schema' && c.passed));

  let dbScore = 0;
  let dbDetails = 'No database or schema detected.';
  if (hasDatabases && !hasDbMissingWarning) {
    dbScore = 20;
    dbDetails = `Database schema detected for: ${profile.databases.join(', ')}`;
  } else if (hasDatabases && hasDbMissingWarning) {
    dbScore = 0;
    dbDetails = `Database detected (${profile.databases.join(', ')}), but missing schema or migrations.`;
    recommendations.push('Add a database schema (schema.prisma, drizzle.config, or migrations/) to guide queries.');
  } else if (hasDbChecksPassed) {
    dbScore = 20;
    dbDetails = 'Database schema verified.';
  } else {
    // If project has no database requirement, note this in details
    dbDetails = 'No database detected in workspace.';
  }

  // 3. Test Files (+20)
  const hasTestingFramework = Array.isArray(profile.frameworks) && profile.frameworks.some((f) =>
    /jest|vitest|pytest|mocha|playwright|cypress/i.test(f)
  );
  const hasTestKeyDir = Boolean(profile.keyDirectories && (profile.keyDirectories['tests'] || profile.keyDirectories['test']));
  const hasTestMissingWarning = missingContext.some((m) => /no testing framework/i.test(m));
  const hasTestChecksPassed = Boolean(profile.checks?.some((c) => /test/i.test(c.id) && c.passed));

  let testScore = 0;
  let testDetails = 'No testing framework or test files detected.';
  if ((hasTestingFramework || hasTestKeyDir || hasTestChecksPassed) && !hasTestMissingWarning) {
    testScore = 20;
    testDetails = hasTestingFramework
      ? `Testing framework detected: ${profile.frameworks.filter((f) => /jest|vitest|pytest|mocha|playwright|cypress/i.test(f)).join(', ')}`
      : 'Test suite and test files found in workspace.';
  } else if (!hasTestMissingWarning && (hasTestingFramework || hasTestKeyDir)) {
    testScore = 20;
    testDetails = 'Test files found in workspace.';
  } else {
    testScore = 0;
    testDetails = 'No test files or testing framework found.';
    recommendations.push('Add test files or configure a test runner (Vitest, Jest, Pytest) for automated verification.');
  }

  // 4. CI/CD or Docker Configs (+20)
  const isCiMissing = missingContext.some((m) => /no ci\/cd/i.test(m));
  const isDockerMissing = missingContext.some((m) => /no docker|no container/i.test(m));
  const hasCiOrDockerChecks = Boolean(
    profile.checks?.some((c) => (c.id === 'bonus_ci_cd' || c.id === 'bonus_container') && c.passed)
  );

  let ciDockerScore = 0;
  let ciDockerDetails = 'No CI/CD or Docker configs detected.';
  if (hasCiOrDockerChecks || (!isCiMissing && !isDockerMissing)) {
    ciDockerScore = 20;
    ciDockerDetails = 'CI/CD workflows and container configuration detected.';
  } else if (!isCiMissing || !isDockerMissing) {
    ciDockerScore = 20;
    ciDockerDetails = !isCiMissing ? 'CI/CD pipeline detected.' : 'Docker/container configuration detected.';
  } else {
    ciDockerScore = 0;
    ciDockerDetails = 'Neither CI/CD workflows nor Docker configuration detected.';
    recommendations.push('Add a GitHub Actions workflow (.github/workflows) or Dockerfile to establish build context.');
  }

  // 5. Correction Memories (+20: +4 per rule up to 5 rules)
  const safeCorrectionsCount = Math.max(0, correctionsCount);
  let correctionScore = 0;
  let correctionDetails = '';

  if (safeCorrectionsCount >= 5) {
    correctionScore = 20;
    correctionDetails = `${safeCorrectionsCount} user preferences & corrections recorded (Full alignment).`;
  } else {
    correctionScore = safeCorrectionsCount * 4;
    correctionDetails = `${safeCorrectionsCount} / 5 user corrections recorded (+${correctionScore}/20 pts).`;
    recommendations.push(
      `Save ${5 - safeCorrectionsCount} more user preferences via "💡 Remember this preference" to maximize alignment.`
    );
  }

  // 6. Deductions for missingContext
  const PENALTY_PER_ITEM = 5;
  const totalPenalty = missingContext.length * PENALTY_PER_ITEM;

  const rawScore = langScore + dbScore + testScore + ciDockerScore + correctionScore;
  const finalScore = Math.max(0, Math.min(100, rawScore - totalPenalty));
  const grade = computeGrade(finalScore);

  const breakdown: ContextScoreBreakdown = {
    languageAndFrameworks: {
      score: langScore,
      max: 20,
      passed: langScore >= 20,
      details: langDetails
    },
    databaseSchema: {
      score: dbScore,
      max: 20,
      passed: dbScore >= 20,
      details: dbDetails
    },
    testFiles: {
      score: testScore,
      max: 20,
      passed: testScore >= 20,
      details: testDetails
    },
    ciCdOrDocker: {
      score: ciDockerScore,
      max: 20,
      passed: ciDockerScore >= 20,
      details: ciDockerDetails
    },
    correctionMemories: {
      score: correctionScore,
      max: 20,
      passed: safeCorrectionsCount >= 5,
      count: safeCorrectionsCount,
      details: correctionDetails
    },
    missingContextPenalties: {
      penalty: totalPenalty,
      items: missingContext
    }
  };

  return {
    score: finalScore,
    grade,
    rawScore,
    totalPenalty,
    breakdown,
    detectedStack: {
      primaryLanguage: profile.primaryLanguage || 'Unknown',
      frameworks: profile.frameworks || [],
      databases: profile.databases || [],
      architecture: profile.architecture || 'Modular Application',
      keyDirectories: profile.keyDirectories || {}
    },
    missingContext,
    recommendations,
    lastCalculated: Date.now()
  };
}

/**
 * High-level helper: scans workspace (or reads cache), loads corrections, and calculates Context Audit Score.
 */
export async function auditWorkspaceContext(workspacePath: string): Promise<ContextScoreResult> {
  const profile = await getOrScanWorkspaceProfile(workspacePath);
  const corrections = await getCorrectionEntries(workspacePath);
  return calculateContextScore(profile, corrections.length);
}
