import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  extractDesignSystem,
  parseTailwindConfig,
  parseCssVariables,
  clearDesignProfileCache,
  getCachedDesignProfile,
  type DesignProfile
} from '../src/main/services/context-engine/design-system-extractor';
import { buildProjectDesignPrompt } from '../src/main/agent/canvas-agent-engine';
import { generateProjectNativeCode } from '../src/renderer/src/components/canvas/M3ECanvas';
import type { WorkspaceProfile } from '../src/main/services/context-engine/workspace-scanner';
import type { CanvasNode } from '../src/renderer/src/state/canvas-store';

describe('Project-Native M3E Canvas: Design System & Stack Extraction', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tycode-canvas-test-'));
    clearDesignProfileCache();
  });

  afterEach(() => {
    clearDesignProfileCache();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Tailwind Config Parser', () => {
    it('extracts custom colors, spacing scales, and breakpoints from tailwind config string', () => {
      const configContent = `
        module.exports = {
          theme: {
            extend: {
              colors: {
                primary: '#2563eb',
                secondary: '#64748b',
                brand: {
                  DEFAULT: '#7c3aed',
                  light: '#a78bfa',
                  dark: '#4c1d95'
                }
              },
              spacing: {
                '128': '32rem',
                '144': '36rem'
              },
              screens: {
                '3xl': '1920px'
              }
            }
          }
        };
      `;

      const result = parseTailwindConfig(configContent);
      expect(result.colors['primary']).toBe('#2563eb');
      expect(result.colors['secondary']).toBe('#64748b');
      expect(result.colors['brand']).toBe('#7c3aed');
      expect(result.colors['brand-light']).toBe('#a78bfa');
      expect(result.colors['brand-dark']).toBe('#4c1d95');
      expect(result.spacing['128']).toBe('32rem');
      expect(result.spacing['144']).toBe('36rem');
      expect(result.breakpoints['3xl']).toBe('1920px');
    });

    it('extracts colors defined using CSS variables or HSL/RGB formats', () => {
      const configContent = `
        export default {
          theme: {
            colors: {
              background: 'hsl(var(--background))',
              foreground: 'hsl(var(--foreground))',
              card: '#ffffff'
            }
          }
        };
      `;

      const result = parseTailwindConfig(configContent);
      expect(result.colors['card']).toBe('#ffffff');
      expect(result.colors['background']).toBe('hsl(var(--background))');
      expect(result.colors['foreground']).toBe('hsl(var(--foreground))');
    });
  });

  describe('CSS Variables Parser', () => {
    it('extracts custom color variables from globals.css style rules', () => {
      const cssContent = `
        :root {
          --background: 0 0% 100%;
          --foreground: 222.2 84% 4.9%;
          --primary: #3b82f6;
          --secondary: rgb(100, 116, 139);
          --accent: #a855f7;
        }
        .dark {
          --background: 222.2 84% 4.9%;
        }
      `;

      const vars = parseCssVariables(cssContent);
      expect(vars['primary']).toBe('#3b82f6');
      expect(vars['accent']).toBe('#a855f7');
      expect(vars['secondary']).toBe('rgb(100, 116, 139)');
      expect(vars['background']).toBe('0 0% 100%');
    });
  });

  describe('extractDesignSystem (Full Scan & Cache)', () => {
    it('scans a shadcn/ui project with Next.js App Router and returns a complete DesignProfile', async () => {
      // 1. package.json
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({
          name: 'next-shadcn-app',
          dependencies: {
            next: '^14.2.0',
            react: '^18.3.0',
            'react-dom': '^18.3.0',
            tailwindcss: '^3.4.0',
            '@radix-ui/react-slot': '^1.0.2'
          }
        }, null, 2)
      );

      // 2. Next.js App Router indicator
      const appDir = path.join(tempDir, 'app');
      fs.mkdirSync(appDir, { recursive: true });
      fs.writeFileSync(path.join(appDir, 'layout.tsx'), 'export default function RootLayout() {}');

      // 3. tailwind.config.ts
      fs.writeFileSync(
        path.join(tempDir, 'tailwind.config.ts'),
        `export default {
          theme: {
            extend: {
              colors: {
                primary: '#3b82f6',
                destructive: '#ef4444'
              }
            }
          }
        };`
      );

      // 4. components/ui (shadcn)
      const uiDir = path.join(tempDir, 'components', 'ui');
      fs.mkdirSync(uiDir, { recursive: true });
      fs.writeFileSync(path.join(uiDir, 'button.tsx'), 'export function Button() {}');
      fs.writeFileSync(path.join(uiDir, 'card.tsx'), 'export function Card() {}');
      fs.writeFileSync(path.join(uiDir, 'input.tsx'), 'export function Input() {}');
      fs.writeFileSync(path.join(uiDir, 'dialog.tsx'), 'export function Dialog() {}');

      const profile = await extractDesignSystem(tempDir);

      expect(profile.framework).toBe('Next.js');
      expect(profile.routerType).toBe('app-router');
      expect(profile.uiLibrary).toBe('shadcn/ui');
      expect(profile.colors['primary']).toBe('#3b82f6');
      expect(profile.colors['destructive']).toBe('#ef4444');
      expect(profile.components.length).toBe(4);

      const compNames = profile.components.map((c) => c.name);
      expect(compNames).toContain('Button');
      expect(compNames).toContain('Card');
      expect(compNames).toContain('Input');
      expect(compNames).toContain('Dialog');

      // Verify caching: second call returns cached profile immediately
      const cached = getCachedDesignProfile(tempDir);
      expect(cached).not.toBeNull();
      expect(cached?.uiLibrary).toBe('shadcn/ui');

      // After clearDesignProfileCache(), cached profile is cleared
      clearDesignProfileCache();
      expect(getCachedDesignProfile(tempDir)).toBeNull();
    });

    it('falls back to Material UI or Chakra when installed in package.json', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({
          name: 'mui-vite-app',
          dependencies: {
            react: '^18.2.0',
            '@mui/material': '^5.15.0'
          }
        }, null, 2)
      );

      const profile = await extractDesignSystem(tempDir);
      expect(profile.uiLibrary).toBe('Material UI');
      const compNames = profile.components.map((c) => c.name);
      expect(compNames).toContain('Button');
      expect(compNames).toContain('TextField');
    });
  });

  describe('Canvas AI System Prompt Injection', () => {
    it('injects [PROJECT DESIGN SYSTEM] and [FRAMEWORK RULES] into the system prompt', () => {
      const designProfile: DesignProfile = {
        framework: 'Next.js',
        routerType: 'app-router',
        uiLibrary: 'shadcn/ui',
        colors: {
          primary: '#3b82f6',
          secondary: '#64748b',
          destructive: '#ef4444'
        },
        tailwindClasses: ['bg-primary', 'text-primary-foreground', 'bg-destructive'],
        spacing: { '128': '32rem' },
        breakpoints: { '2xl': '1536px' },
        components: [
          { name: 'Button', importPath: '@/components/ui/button', tag: 'button' },
          { name: 'Card', importPath: '@/components/ui/card', tag: 'card' },
          { name: 'Input', importPath: '@/components/ui/input', tag: 'input' }
        ]
      };

      const workspaceProfile: WorkspaceProfile = {
        languages: ['TypeScript', 'JavaScript'],
        frameworks: ['Next.js', 'React', 'Tailwind CSS'],
        database: { type: 'PostgreSQL' },
        architecture: 'Monolith',
        testFrameworks: ['Vitest'],
        ciCd: ['GitHub Actions']
      };

      const promptAddition = buildProjectDesignPrompt(designProfile, workspaceProfile);

      expect(promptAddition).toContain('[PROJECT DESIGN SYSTEM]');
      expect(promptAddition).toContain('primary: #3b82f6');
      expect(promptAddition).toContain('shadcn/ui');
      expect(promptAddition).toContain('Button, Card, Input');
      expect(promptAddition).toContain('Do NOT invent new CSS classes if a Tailwind utility or base component exists.');
      expect(promptAddition).toContain('[FRAMEWORK RULES]');
      expect(promptAddition).toContain('Next.js (app-router)');
      expect(promptAddition).toContain("'use client' for Next.js App Router interactive components");
    });
  });

  describe('Canvas Safe Edit Review Gate: Project-Native Code Generator', () => {
    it('generates React code with use client and shadcn/ui imports for Next.js App Router', () => {
      const designProfile: DesignProfile = {
        framework: 'Next.js',
        routerType: 'app-router',
        uiLibrary: 'shadcn/ui',
        colors: { primary: '#2563eb' },
        tailwindClasses: ['bg-primary'],
        spacing: {},
        breakpoints: {},
        components: [
          { name: 'Button', importPath: '@/components/ui/button', tag: 'button' },
          { name: 'Card', importPath: '@/components/ui/card', tag: 'card' },
          { name: 'Input', importPath: '@/components/ui/input', tag: 'input' }
        ]
      };

      const nodes: CanvasNode[] = [
        {
          id: 'node_1',
          type: 'card',
          platform: 'web',
          props: { x: 20, y: 30, width: 300, height: 200, text: 'Login Card' },
          children: [
            {
              id: 'node_2',
              type: 'input',
              platform: 'web',
              props: { text: 'Email' },
              children: []
            },
            {
              id: 'node_3',
              type: 'button',
              platform: 'web',
              props: { text: 'Sign In' },
              children: []
            }
          ]
        }
      ];

      const code = generateProjectNativeCode(nodes, 'web', designProfile, 'LoginForm');

      expect(code).toContain("'use client';");
      expect(code).toContain("import { Button } from '@/components/ui/button';");
      expect(code).toContain("import { Card } from '@/components/ui/card';");
      expect(code).toContain("import { Input } from '@/components/ui/input';");
      expect(code).toContain('export default function LoginForm()');
      expect(code).toContain('<Button className="bg-primary text-primary-foreground');
      expect(code).toContain('<Input placeholder="Email"');
    });

    it('generates standard React code without use client directive for Vite/SPA projects', () => {
      const designProfile: DesignProfile = {
        framework: 'React',
        routerType: 'none',
        uiLibrary: 'Tailwind CSS',
        colors: { primary: '#10b981' },
        tailwindClasses: [],
        spacing: {},
        breakpoints: {},
        components: []
      };

      const nodes: CanvasNode[] = [
        {
          id: 'node_btn',
          type: 'button',
          platform: 'web',
          props: { text: 'Submit' },
          children: []
        }
      ];

      const code = generateProjectNativeCode(nodes, 'web', designProfile, 'SubmitButton');

      expect(code).not.toContain("'use client';");
      expect(code).toContain('export default function SubmitButton()');
      expect(code).toContain('<button className="px-4 py-2 rounded-md bg-primary');
    });
  });
});
