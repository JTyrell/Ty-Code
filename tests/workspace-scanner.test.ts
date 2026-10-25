import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { scanWorkspace } from '../src/main/services/context-engine/workspace-scanner';
import { WorkspaceProfileSchema } from '../src/main/services/context-engine/types';

describe('Ty-Code Context Engine: Workspace Intelligence Scanner', () => {
  let tempWorkspace: string;

  beforeEach(async () => {
    tempWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'tycode-scanner-test-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(tempWorkspace, { recursive: true, force: true });
    } catch {}
  });

  it('scans a TypeScript Next.js App Router project and detects frameworks, DBs, and key directories', async () => {
    // 1. Setup manifest and config files
    await fs.writeFile(
      path.join(tempWorkspace, 'package.json'),
      JSON.stringify(
        {
          name: 'my-app',
          version: '1.0.0',
          dependencies: {
            next: '^14.0.0',
            react: '^18.2.0',
            tailwindcss: '^3.4.0',
            '@trpc/server': '^10.0.0'
          },
          devDependencies: {
            vitest: '^1.0.0',
            typescript: '^5.0.0'
          }
        },
        null,
        2
      )
    );
    await fs.writeFile(path.join(tempWorkspace, 'tsconfig.json'), '{}');

    // 2. Setup key directories and files
    await fs.mkdir(path.join(tempWorkspace, 'src', 'app', 'api'), { recursive: true });
    await fs.writeFile(path.join(tempWorkspace, 'src', 'app', 'page.tsx'), 'export default function Page() {}');
    await fs.writeFile(path.join(tempWorkspace, 'src', 'app', 'layout.tsx'), 'export default function Layout() {}');

    await fs.mkdir(path.join(tempWorkspace, 'src', 'components'), { recursive: true });
    await fs.writeFile(path.join(tempWorkspace, 'src', 'components', 'Button.tsx'), 'export const Button = () => null;');

    await fs.mkdir(path.join(tempWorkspace, 'src', 'services'), { recursive: true });
    await fs.writeFile(path.join(tempWorkspace, 'src', 'services', 'user.ts'), 'export const getUser = () => null;');

    // 3. Setup Prisma schema & Docker Compose
    await fs.mkdir(path.join(tempWorkspace, 'prisma'), { recursive: true });
    await fs.writeFile(
      path.join(tempWorkspace, 'prisma', 'schema.prisma'),
      `datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}`
    );

    await fs.writeFile(
      path.join(tempWorkspace, 'docker-compose.yml'),
      `version: '3.8'
services:
  db:
    image: postgres:15
  cache:
    image: redis:alpine`
    );

    await fs.writeFile(
      path.join(tempWorkspace, '.env.example'),
      `DATABASE_URL=postgres://user:pass@localhost:5432/mydb
REDIS_URL=redis://localhost:6379`
    );

    // 4. Run Scanner
    const profile = await scanWorkspace(tempWorkspace);

    // 5. Assertions
    expect(profile.primaryLanguage).toBe('TypeScript');
    expect(profile.frameworks).toContain('Next.js');
    expect(profile.frameworks).toContain('React');
    expect(profile.frameworks).toContain('Tailwind CSS');
    expect(profile.frameworks).toContain('tRPC');
    expect(profile.databases).toContain('PostgreSQL');
    expect(profile.databases).toContain('Redis');
    expect(profile.architecture).toBe('Next.js App Router');
    expect(profile.keyDirectories['components']).toBe('src/components');
    expect(profile.keyDirectories['app']).toBe('src/app');
    expect(profile.keyDirectories['api']).toBe('src/app/api');
    expect(profile.keyDirectories['services']).toBe('src/services');

    // Validates against Zod schema
    const validated = WorkspaceProfileSchema.safeParse(profile);
    expect(validated.success).toBe(true);
  });

  it('detects a Monorepo workspace architecture', async () => {
    await fs.writeFile(
      path.join(tempWorkspace, 'package.json'),
      JSON.stringify(
        {
          name: 'monorepo-root',
          workspaces: ['packages/*', 'apps/*']
        },
        null,
        2
      )
    );
    await fs.mkdir(path.join(tempWorkspace, 'packages', 'core'), { recursive: true });
    await fs.mkdir(path.join(tempWorkspace, 'apps', 'web'), { recursive: true });

    const profile = await scanWorkspace(tempWorkspace);
    expect(profile.architecture).toBe('Monorepo');
    expect(profile.keyDirectories['packages']).toBe('packages');
  });

  it('detects an MVC pattern with controllers and services', async () => {
    await fs.writeFile(path.join(tempWorkspace, 'package.json'), JSON.stringify({ name: 'mvc-app' }));
    await fs.mkdir(path.join(tempWorkspace, 'src', 'controllers'), { recursive: true });
    await fs.mkdir(path.join(tempWorkspace, 'src', 'services'), { recursive: true });
    await fs.mkdir(path.join(tempWorkspace, 'src', 'models'), { recursive: true });

    const profile = await scanWorkspace(tempWorkspace);
    expect(profile.architecture).toBe('MVC / Layered Architecture');
    expect(profile.keyDirectories['controllers']).toBe('src/controllers');
    expect(profile.keyDirectories['services']).toBe('src/services');
    expect(profile.keyDirectories['models']).toBe('src/models');
  });

  it('detects a Python project with FastAPI and SQLite', async () => {
    await fs.writeFile(
      path.join(tempWorkspace, 'requirements.txt'),
      `fastapi>=0.100.0
sqlalchemy>=2.0.0
pytest>=7.0.0
celery>=5.3.0`
    );
    await fs.writeFile(path.join(tempWorkspace, 'main.py'), 'from fastapi import FastAPI\napp = FastAPI()');
    await fs.writeFile(path.join(tempWorkspace, '.env.example'), 'DATABASE_URL=sqlite:///./sql_app.db');

    const profile = await scanWorkspace(tempWorkspace);
    expect(profile.primaryLanguage).toBe('Python');
    expect(profile.frameworks).toContain('FastAPI');
    expect(profile.frameworks).toContain('Celery');
    expect(profile.databases).toContain('SQLite');
  });

  it('detects a Rust project with Cargo.toml', async () => {
    await fs.writeFile(
      path.join(tempWorkspace, 'Cargo.toml'),
      `[package]
name = "rusty-server"
version = "0.1.0"
edition = "2021"

[dependencies]
axum = "0.7"
tokio = { version = "1.0", features = ["full"] }`
    );
    await fs.mkdir(path.join(tempWorkspace, 'src'), { recursive: true });
    await fs.writeFile(path.join(tempWorkspace, 'src', 'main.rs'), 'fn main() {}');

    const profile = await scanWorkspace(tempWorkspace);
    expect(profile.primaryLanguage).toBe('Rust');
    expect(profile.frameworks).toContain('Axum');
    expect(profile.frameworks).toContain('Tokio');
  });

  it('identifies missing context such as testing, CI/CD, and docker', async () => {
    await fs.writeFile(path.join(tempWorkspace, 'package.json'), JSON.stringify({ name: 'bare-bones' }));
    await fs.writeFile(path.join(tempWorkspace, 'index.js'), 'console.log("hello");');

    const profile = await scanWorkspace(tempWorkspace);
    expect(profile.missingContext).toContain('No testing framework detected');
    expect(profile.missingContext).toContain('No CI/CD pipeline detected');
    expect(profile.missingContext).toContain('No Docker or container configuration detected');
  });
});
