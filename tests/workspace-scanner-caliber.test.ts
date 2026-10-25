import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { scanWorkspace } from '../src/main/services/context-engine/workspace-scanner';
import { WorkspaceProfileSchema } from '../src/main/services/context-engine/types';

describe('Ty-Code Context Engine: Caliber Mechanics Integration', () => {
  let tempWorkspace: string;

  beforeEach(async () => {
    tempWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'tycode-caliber-test-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(tempWorkspace, { recursive: true, force: true });
    } catch {}
  });

  it('evaluates AI readiness, calculates letter grade, and tracks existing configs', async () => {
    // 1. Setup workspace with AGENTS.md, skills, rules, and MCP config
    await fs.writeFile(
      path.join(tempWorkspace, 'package.json'),
      JSON.stringify(
        {
          name: 'caliber-style-app',
          version: '1.0.0',
          scripts: {
            build: 'tsc',
            test: 'vitest',
            dev: 'vite'
          },
          dependencies: {
            react: '^18.2.0',
            vite: '^5.0.0'
          },
          devDependencies: {
            typescript: '^5.0.0',
            vitest: '^1.0.0'
          }
        },
        null,
        2
      )
    );

    // Create primary AGENTS.md instruction file with structured sections and code blocks
    const agentsMdContent = `# Project Context

## Architecture
The application is structured into \`src/components\` and \`src/services\`.

## Commands
Run the development server:
\`\`\`bash
npm run dev
\`\`\`

Build for production:
\`\`\`bash
npm run build
\`\`\`

Execute test suites:
\`\`\`bash
npm test
\`\`\`

## Testing
Unit and integration tests are located in \`tests/\`.

## Conventions
Follow strict TypeScript types and modular component design.
`;
    await fs.writeFile(path.join(tempWorkspace, 'AGENTS.md'), agentsMdContent);

    // Create directories referenced in AGENTS.md
    await fs.mkdir(path.join(tempWorkspace, 'src', 'components'), { recursive: true });
    await fs.writeFile(path.join(tempWorkspace, 'src', 'components', 'App.tsx'), 'export const App = () => null;');
    await fs.mkdir(path.join(tempWorkspace, 'src', 'services'), { recursive: true });
    await fs.writeFile(path.join(tempWorkspace, 'src', 'services', 'api.ts'), 'export const api = {};');
    await fs.mkdir(path.join(tempWorkspace, 'tests'), { recursive: true });
    await fs.writeFile(path.join(tempWorkspace, 'tests', 'App.test.tsx'), '// test');

    // Setup .agents/rules
    await fs.mkdir(path.join(tempWorkspace, '.agents', 'rules'), { recursive: true });
    await fs.writeFile(
      path.join(tempWorkspace, '.agents', 'rules', 'typescript.md'),
      '# TypeScript Rules\nAlways prefer interfaces over type aliases for objects.'
    );

    // Setup .agents/skills
    await fs.mkdir(path.join(tempWorkspace, '.agents', 'skills', 'deploy'), { recursive: true });
    await fs.writeFile(
      path.join(tempWorkspace, '.agents', 'skills', 'deploy', 'SKILL.md'),
      '---\nname: deploy\n---\nRun deploy command.'
    );

    // Setup MCP configuration
    await fs.writeFile(
      path.join(tempWorkspace, 'mcp_config.json'),
      JSON.stringify({
        mcpServers: {
          filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] }
        }
      })
    );

    // Setup CI/CD and Docker
    await fs.mkdir(path.join(tempWorkspace, '.github', 'workflows'), { recursive: true });
    await fs.writeFile(path.join(tempWorkspace, '.github', 'workflows', 'ci.yml'), 'name: CI');
    await fs.writeFile(path.join(tempWorkspace, 'Dockerfile'), 'FROM node:20');

    // 2. Scan workspace
    const profile = await scanWorkspace(tempWorkspace);

    // 3. Verify Caliber intelligence metrics
    expect(profile.readinessScore).toBeDefined();
    expect(profile.readinessScore).toBeGreaterThanOrEqual(80);
    expect(['A+', 'A', 'A-', 'B+']).toContain(profile.readinessGrade);

    // Verify existing configs
    expect(profile.existingConfigs).toBeDefined();
    expect(profile.existingConfigs?.hasInstructions).toBe(true);
    expect(profile.existingConfigs?.instructionFiles).toContain('AGENTS.md');
    expect(profile.existingConfigs?.rulesCount).toBe(1);
    expect(profile.existingConfigs?.skillsCount).toBe(1);
    expect(profile.existingConfigs?.mcpServersCount).toBe(1);

    // Verify checks
    expect(profile.checks).toBeDefined();
    const checks = profile.checks!;
    expect(checks.some((c) => c.id === 'existence_instructions' && c.passed)).toBe(true);
    expect(checks.some((c) => c.id === 'existence_rules' && c.passed)).toBe(true);
    expect(checks.some((c) => c.id === 'existence_skills' && c.passed)).toBe(true);
    expect(checks.some((c) => c.id === 'existence_mcp' && c.passed)).toBe(true);
    expect(checks.some((c) => c.id === 'quality_executable_blocks' && c.passed)).toBe(true);
    expect(checks.some((c) => c.id === 'quality_structured_sections' && c.passed)).toBe(true);
    expect(checks.some((c) => c.id === 'grounding_workspace_references' && c.passed)).toBe(true);
    expect(checks.some((c) => c.id === 'bonus_ci_cd' && c.passed)).toBe(true);
    expect(checks.some((c) => c.id === 'bonus_containers' && c.passed)).toBe(true);

    // Verify category scores
    expect(profile.categoryScores).toBeDefined();
    expect(profile.categoryScores?.existence.earned).toBeGreaterThanOrEqual(25);
    expect(profile.categoryScores?.quality.earned).toBeGreaterThanOrEqual(20);

    // Verify code stats
    expect(profile.codeStats).toBeDefined();
    expect(profile.codeStats?.totalFiles).toBeGreaterThan(0);
    expect(profile.codeStats?.sourceFiles).toBeGreaterThan(0);
    expect(profile.codeStats?.estimatedTokens).toBeGreaterThan(0);

    // Verify Zod schema validation
    const validation = WorkspaceProfileSchema.safeParse(profile);
    expect(validation.success).toBe(true);
  });

  it('flags missing instructions, rules, and skills for unconfigured repositories', async () => {
    await fs.writeFile(path.join(tempWorkspace, 'package.json'), JSON.stringify({ name: 'bare-project' }));
    await fs.writeFile(path.join(tempWorkspace, 'index.js'), 'console.log("clean");');

    const profile = await scanWorkspace(tempWorkspace);

    expect(profile.readinessScore).toBeDefined();
    expect(profile.readinessScore).toBeLessThan(60);
    expect(['C', 'D', 'F']).toContain(profile.readinessGrade);

    expect(profile.existingConfigs?.hasInstructions).toBe(false);
    expect(profile.existingConfigs?.rulesCount).toBe(0);
    expect(profile.existingConfigs?.skillsCount).toBe(0);

    // Verify suggestions appear in missingContext
    expect(profile.missingContext.some((m) => m.toLowerCase().includes('agents.md'))).toBe(true);
    expect(profile.missingContext.some((m) => m.toLowerCase().includes('rule'))).toBe(true);
  });

  it('sanitizes secrets and ignores private keys from code analysis', async () => {
    await fs.writeFile(path.join(tempWorkspace, 'package.json'), JSON.stringify({ name: 'secret-project' }));
    await fs.writeFile(path.join(tempWorkspace, '.env'), 'API_KEY=super_secret_password_123');
    await fs.writeFile(path.join(tempWorkspace, 'id_rsa'), '-----BEGIN OPENSSH PRIVATE KEY-----');
    await fs.writeFile(path.join(tempWorkspace, 'cert.pem'), '-----BEGIN CERTIFICATE-----');
    await fs.writeFile(path.join(tempWorkspace, 'main.ts'), 'export const hello = "world";');

    const profile = await scanWorkspace(tempWorkspace);

    expect(profile.primaryLanguage).toBe('TypeScript');
    // .env, id_rsa, cert.pem should not be counted as source files
    expect(profile.codeStats?.sourceFiles).toBe(1);
  });
});
