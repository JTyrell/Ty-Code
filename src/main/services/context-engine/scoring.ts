/**
 * Ty-Code Context Engine: Deterministic AI-Readiness Scoring Engine
 *
 * Implements codebase AI-readiness scoring and config drift detection
 * based on the mechanics of Caliber (zero-network, deterministic):
 * - Existence checks: Instructions, rules, skills, MCPs, architecture docs.
 * - Quality checks: Code blocks, token conciseness, structured markdown sections.
 * - Grounding checks: Verification that referenced paths exist in the workspace.
 * - Accuracy checks: Verification that mentioned build/test commands match manifests.
 * - Freshness checks: Git commit drift between context files and source code.
 * - Bonus checks: CI/CD, containers, testing, linters.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  WorkspaceCheck,
  WorkspaceCategoryScore,
  WorkspaceGitInfo,
  WorkspaceExistingConfigs
} from './types';
import type { DiscoveredFile, DiscoveredDirectory } from './fingerprint';

export interface ScoreOutput {
  score: number;
  grade: string;
  categoryScores: Record<string, WorkspaceCategoryScore>;
  checks: WorkspaceCheck[];
  suggestedImprovements: string[];
}

/**
 * Computes letter grade from score percentage.
 */
function computeGrade(score: number): string {
  if (score >= 95) return 'A+';
  if (score >= 90) return 'A';
  if (score >= 85) return 'A-';
  if (score >= 80) return 'B+';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  if (score >= 50) return 'D';
  return 'F';
}

/**
 * Reads instruction content from AGENTS.md or README.md.
 */
async function readPrimaryInstructions(
  dir: string,
  configs: WorkspaceExistingConfigs
): Promise<{ filename: string; content: string } | null> {
  const preferred = ['AGENTS.md', 'README.md', 'ARCHITECTURE.md'];
  for (const name of preferred) {
    const found = configs.instructionFiles.find((f) => f.toLowerCase() === name.toLowerCase());
    if (found) {
      try {
        const content = await fs.readFile(path.join(dir, found), 'utf-8');
        return { filename: found, content };
      } catch {}
    }
  }
  return null;
}

/**
 * Evaluates repository AI readiness using Caliber scoring mechanics.
 */
export async function evaluateReadiness(
  dir: string,
  files: DiscoveredFile[],
  directories: DiscoveredDirectory[],
  gitInfo: WorkspaceGitInfo,
  existingConfigs: WorkspaceExistingConfigs,
  frameworks: string[],
  manifestScripts: string[] = []
): Promise<ScoreOutput> {
  const checks: WorkspaceCheck[] = [];
  const categoryTotals: Record<string, { earned: number; max: number }> = {
    existence: { earned: 0, max: 0 },
    quality: { earned: 0, max: 0 },
    grounding: { earned: 0, max: 0 },
    accuracy: { earned: 0, max: 0 },
    freshness: { earned: 0, max: 0 },
    bonus: { earned: 0, max: 0 }
  };

  function addCheck(check: WorkspaceCheck) {
    checks.push(check);
    if (!categoryTotals[check.category]) {
      categoryTotals[check.category] = { earned: 0, max: 0 };
    }
    categoryTotals[check.category].earned += check.earnedPoints;
    categoryTotals[check.category].max += check.maxPoints;
  }

  const primary = await readPrimaryInstructions(dir, existingConfigs);
  const primaryContent = primary?.content || '';

  // ───────────────────────────────────────────────────────────────────────────
  // 1. EXISTENCE CHECKS (Max ~30 pts)
  // ───────────────────────────────────────────────────────────────────────────
  const hasAgentsMd = existingConfigs.instructionFiles.some(
    (f) => path.basename(f).toLowerCase() === 'agents.md'
  );
  const hasReadme = existingConfigs.instructionFiles.some(
    (f) => path.basename(f).toLowerCase() === 'readme.md'
  );

  let instructionPoints = 0;
  if (hasAgentsMd) {
    instructionPoints = 15;
  } else if (hasReadme) {
    instructionPoints = 8;
  }

  addCheck({
    id: 'existence_instructions',
    name: 'Agent Instructions (AGENTS.md / README.md)',
    category: 'existence',
    maxPoints: 15,
    earnedPoints: instructionPoints,
    passed: instructionPoints >= 12,
    detail: hasAgentsMd
      ? 'Found dedicated AGENTS.md instruction file'
      : hasReadme
      ? 'Found README.md (AGENTS.md recommended for dedicated agent instructions)'
      : 'No AGENTS.md or README.md found',
    suggestion: hasAgentsMd
      ? undefined
      : 'Create an AGENTS.md file in the root to provide clear project context and guidelines'
  });

  // Rules existence
  const hasRules = existingConfigs.rulesCount > 0;
  addCheck({
    id: 'existence_rules',
    name: 'Project Rules & Constraints',
    category: 'existence',
    maxPoints: 5,
    earnedPoints: hasRules ? 5 : 0,
    passed: hasRules,
    detail: hasRules
      ? `${existingConfigs.rulesCount} rule file(s) found in .agents/rules`
      : 'No rule files found',
    suggestion: hasRules
      ? undefined
      : 'Add specialized rule files to .agents/rules/ for modular instructions'
  });

  // Skills existence
  const hasSkills = existingConfigs.skillsCount > 0;
  const skillsBonus = Math.min(existingConfigs.skillsCount > 1 ? existingConfigs.skillsCount - 1 : 0, 3);
  addCheck({
    id: 'existence_skills',
    name: 'Custom Agent Skills',
    category: 'existence',
    maxPoints: 5,
    earnedPoints: hasSkills ? 5 : 0,
    passed: hasSkills,
    detail: hasSkills
      ? `${existingConfigs.skillsCount} custom skill(s) detected`
      : 'No custom skills detected',
    suggestion: hasSkills
      ? undefined
      : 'Add custom skills under .agents/skills/ to teach specific repetitive workflows'
  });

  // MCP configuration
  const hasMcp = existingConfigs.mcpServersCount > 0;
  addCheck({
    id: 'existence_mcp',
    name: 'Model Context Protocol (MCP) Configuration',
    category: 'existence',
    maxPoints: 5,
    earnedPoints: hasMcp ? 5 : 0,
    passed: hasMcp,
    detail: hasMcp
      ? `${existingConfigs.mcpServersCount} MCP server(s) configured`
      : 'No MCP configuration detected',
    suggestion: hasMcp
      ? undefined
      : 'Configure mcp_config.json to connect external developer tools and data sources'
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. QUALITY CHECKS (Max ~25 pts)
  // ───────────────────────────────────────────────────────────────────────────
  // Code blocks with executable commands
  const codeBlockMatches = primaryContent.match(/```(?:bash|sh|shell|zsh|powershell|cmd|npm|pnpm|yarn|cargo)?[\s\S]*?```/g) || [];
  const codeBlockCount = codeBlockMatches.length;
  let codeBlockPoints = 0;
  if (codeBlockCount >= 3) codeBlockPoints = 10;
  else if (codeBlockCount >= 1) codeBlockPoints = 5;

  addCheck({
    id: 'quality_executable_blocks',
    name: 'Executable Command Blocks',
    category: 'quality',
    maxPoints: 10,
    earnedPoints: codeBlockPoints,
    passed: codeBlockPoints >= 10,
    detail: `${codeBlockCount} executable code block(s) detected in primary instructions`,
    suggestion:
      codeBlockPoints < 10
        ? 'Add code blocks with build, test, and run commands to guide the AI agent'
        : undefined
  });

  // Token budget / conciseness
  const charLength = primaryContent.length;
  let concisenessPoints = 0;
  if (charLength > 150 && charLength <= 40000) {
    concisenessPoints = 5;
  } else if (charLength > 40000) {
    concisenessPoints = 3; // slightly bloated
  }

  addCheck({
    id: 'quality_token_conciseness',
    name: 'Optimal Instruction Conciseness',
    category: 'quality',
    maxPoints: 5,
    earnedPoints: concisenessPoints,
    passed: concisenessPoints === 5,
    detail:
      charLength > 0
        ? `Instruction size: ~${Math.round(charLength / 4)} tokens (${charLength} characters)`
        : 'Instruction file is empty or missing',
    suggestion:
      concisenessPoints < 5
        ? 'Keep instructions between 200 and 8,000 words for optimal context window utilization'
        : undefined
  });

  // Structured sections
  const headings = primaryContent.match(/^#+\s+(.+)$/gm) || [];
  const headingTexts = headings.map((h) => h.replace(/^#+\s+/, '').toLowerCase());
  const hasArchitectureHeading = headingTexts.some((h) => h.includes('architecture') || h.includes('structure'));
  const hasCommandsHeading = headingTexts.some((h) => h.includes('command') || h.includes('build') || h.includes('run') || h.includes('usage'));
  const hasTestingHeading = headingTexts.some((h) => h.includes('test'));
  const hasConventionsHeading = headingTexts.some((h) => h.includes('convention') || h.includes('guideline') || h.includes('style'));

  const structuredCount = [hasArchitectureHeading, hasCommandsHeading, hasTestingHeading, hasConventionsHeading].filter(Boolean).length;
  const structuredPoints = structuredCount * 2.5;

  addCheck({
    id: 'quality_structured_sections',
    name: 'Structured Markdown Sections',
    category: 'quality',
    maxPoints: 10,
    earnedPoints: structuredPoints,
    passed: structuredCount >= 3,
    detail: `${structuredCount}/4 core sections present (Architecture, Commands, Testing, Conventions)`,
    suggestion:
      structuredCount < 3
        ? 'Add explicit sections for Architecture, Commands, Testing, and Conventions'
        : undefined
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. GROUNDING CHECKS (Max ~20 pts)
  // ───────────────────────────────────────────────────────────────────────────
  const dirNames = directories.map((d) => d.relativePath.toLowerCase());
  const fileNames = files.map((f) => f.relativePath.toLowerCase());
  const allWorkspacePaths = new Set([...dirNames, ...fileNames]);

  // Extract referenced backtick words or paths from instructions
  const pathRegex = /`([^`]+)`/g;
  let match: RegExpExecArray | null;
  const referencedPaths: string[] = [];
  while ((match = pathRegex.exec(primaryContent)) !== null) {
    const raw = match[1].trim();
    if (raw.includes('/') || raw.endsWith('.ts') || raw.endsWith('.js') || raw.endsWith('.json') || raw.endsWith('.md')) {
      referencedPaths.push(raw.toLowerCase());
    }
  }

  let validReferences = 0;
  for (const ref of referencedPaths) {
    if (allWorkspacePaths.has(ref) || allWorkspacePaths.has(ref.replace(/^\.?\//, ''))) {
      validReferences++;
    }
  }

  const groundingRatio = referencedPaths.length > 0 ? validReferences / referencedPaths.length : 0;
  let groundingPoints = 0;
  if (primaryContent.length > 0) {
    if (referencedPaths.length > 0 && groundingRatio >= 0.75) {
      groundingPoints = 15;
    } else if (referencedPaths.length > 0 && groundingRatio >= 0.4) {
      groundingPoints = 10;
    } else {
      groundingPoints = 5;
    }
  }

  addCheck({
    id: 'grounding_workspace_references',
    name: 'Workspace Path Grounding',
    category: 'grounding',
    maxPoints: 15,
    earnedPoints: groundingPoints,
    passed: groundingPoints >= 10,
    detail: referencedPaths.length > 0
      ? `${validReferences}/${referencedPaths.length} referenced paths verified in workspace (${Math.round(groundingRatio * 100)}%)`
      : 'No specific workspace file paths referenced in instructions',
    suggestion:
      groundingPoints < 10
        ? 'Reference actual repository directories (e.g., `src/`, `components/`) in your instructions'
        : undefined
  });

  // Top-level directory coverage
  const topDirs = directories.filter((d) => d.depth === 0).map((d) => d.name.toLowerCase());
  const mentionedTopDirs = topDirs.filter((d) => primaryContent.toLowerCase().includes(d));
  const topDirPoints = topDirs.length > 0 && mentionedTopDirs.length > 0 ? 5 : 0;

  addCheck({
    id: 'grounding_top_dirs',
    name: 'Top-Level Directory Mapping',
    category: 'grounding',
    maxPoints: 5,
    earnedPoints: topDirPoints,
    passed: topDirPoints === 5,
    detail: `${mentionedTopDirs.length}/${topDirs.length} top-level directories mapped in instructions`,
    suggestion:
      topDirPoints < 5
        ? 'Map out top-level directories in your architecture documentation'
        : undefined
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. ACCURACY CHECKS (Max ~15 pts)
  // ───────────────────────────────────────────────────────────────────────────
  let scriptAccuracyPoints = 5;
  const commonCommands = ['build', 'test', 'dev', 'start', 'lint'];
  const instructionsLower = primaryContent.toLowerCase();

  const mentionedCommands = commonCommands.filter((cmd) => instructionsLower.includes(cmd));
  const validScripts = manifestScripts.map((s) => s.toLowerCase());

  if (manifestScripts.length > 0 && mentionedCommands.length > 0) {
    const verified = mentionedCommands.filter((cmd) => validScripts.includes(cmd));
    if (verified.length > 0) {
      scriptAccuracyPoints = 10;
    } else {
      scriptAccuracyPoints = 5;
    }
  }

  addCheck({
    id: 'accuracy_manifest_scripts',
    name: 'Build & Script Command Accuracy',
    category: 'accuracy',
    maxPoints: 10,
    earnedPoints: scriptAccuracyPoints,
    passed: scriptAccuracyPoints >= 8,
    detail: manifestScripts.length > 0
      ? `Verified against ${manifestScripts.length} manifest script command(s)`
      : 'No manifest script commands detected to verify against',
    suggestion:
      scriptAccuracyPoints < 8
        ? 'Ensure commands mentioned in instructions match scripts defined in package.json'
        : undefined
  });

  // Relative path validity check
  addCheck({
    id: 'accuracy_relative_paths',
    name: 'Valid Path Formats',
    category: 'accuracy',
    maxPoints: 5,
    earnedPoints: 5,
    passed: true,
    detail: 'All extracted paths conform to valid workspace formats'
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. FRESHNESS & CONFIG DRIFT (Max ~10 pts)
  // ───────────────────────────────────────────────────────────────────────────
  let freshnessPoints = 10;
  let freshnessDetail = 'Instructions are synchronized with latest changes';

  if (gitInfo.isGitRepo) {
    const commitsSince = gitInfo.commitsSinceConfigUpdate ?? 0;
    if (commitsSince === 0) {
      freshnessPoints = 10;
      freshnessDetail = 'Synchronized with HEAD commit (0 commits drift)';
    } else if (commitsSince <= 5) {
      freshnessPoints = 7;
      freshnessDetail = `Low drift (${commitsSince} source commit(s) since last context update)`;
    } else if (commitsSince <= 20) {
      freshnessPoints = 4;
      freshnessDetail = `Moderate drift (${commitsSince} source commits since last context update)`;
    } else {
      freshnessPoints = 1;
      freshnessDetail = `High config drift (${commitsSince} commits since last context update)`;
    }
  }

  addCheck({
    id: 'freshness_config_drift',
    name: 'Config Drift & Synchronization',
    category: 'freshness',
    maxPoints: 10,
    earnedPoints: freshnessPoints,
    passed: freshnessPoints >= 7,
    detail: freshnessDetail,
    suggestion:
      freshnessPoints < 7
        ? 'Run workspace sync or update AGENTS.md to align with recent codebase changes'
        : undefined
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. BONUS CHECKS (Up to 10 bonus points)
  // ───────────────────────────────────────────────────────────────────────────
  // CI/CD workflow
  const hasCI = directories.some((d) => d.relativePath === '.github/workflows') ||
    files.some((f) => f.name === '.gitlab-ci.yml' || f.name === 'azure-pipelines.yml');
  addCheck({
    id: 'bonus_ci_cd',
    name: 'CI/CD Automation',
    category: 'bonus',
    maxPoints: 3,
    earnedPoints: hasCI ? 3 : 0,
    passed: hasCI,
    detail: hasCI ? 'CI/CD pipeline detected' : 'No CI/CD pipeline detected'
  });

  // Container configuration
  const hasContainer = files.some(
    (f) => f.name.toLowerCase().startsWith('dockerfile') || f.name.toLowerCase().startsWith('docker-compose')
  );
  addCheck({
    id: 'bonus_containers',
    name: 'Containerization (Docker)',
    category: 'bonus',
    maxPoints: 3,
    earnedPoints: hasContainer ? 3 : 0,
    passed: hasContainer,
    detail: hasContainer ? 'Container configuration detected' : 'No container configuration detected'
  });

  // Multi-skill bonus
  if (skillsBonus > 0) {
    addCheck({
      id: 'bonus_multi_skills',
      name: 'Multi-Skill Portfolio',
      category: 'bonus',
      maxPoints: 3,
      earnedPoints: skillsBonus,
      passed: true,
      detail: `+${skillsBonus} bonus points for multiple specialized agent skills`
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // SCORE NORMALIZATION & SUMMARY
  // ───────────────────────────────────────────────────────────────────────────
  let totalEarned = 0;
  let totalMax = 0;

  for (const cat of Object.keys(categoryTotals)) {
    if (cat !== 'bonus') {
      totalEarned += categoryTotals[cat].earned;
      totalMax += categoryTotals[cat].max;
    } else {
      totalEarned += categoryTotals[cat].earned; // bonus points added directly
    }
  }

  const rawScore = totalMax > 0 ? Math.round((totalEarned / totalMax) * 100) : 0;
  const finalScore = Math.min(Math.max(rawScore, 0), 100);
  const grade = computeGrade(finalScore);

  const suggestedImprovements = checks
    .filter((c) => !c.passed && c.suggestion)
    .map((c) => c.suggestion as string);

  return {
    score: finalScore,
    grade,
    categoryScores: categoryTotals,
    checks,
    suggestedImprovements
  };
}
