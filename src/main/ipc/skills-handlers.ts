import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import type { IpcResponse, SkillDefinition } from '../../preload/types';

function parseSkillFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/^---\s*([\s\S]*?)\s*---/);
  if (!match) return {};

  const lines = match[1].split('\n');
  const result: { name?: string; description?: string } = {};

  for (const line of lines) {
    const nameMatch = line.match(/^name:\s*(.+)/i);
    if (nameMatch) {
      result.name = nameMatch[1].trim().replace(/^['"]|['"]$/g, '');
    }
    const descMatch = line.match(/^description:\s*(.+)/i);
    if (descMatch) {
      result.description = descMatch[1].trim().replace(/^['"]|['"]$/g, '');
    }
  }

  return result;
}

export async function getAvailableSkills(workspacePath: string): Promise<IpcResponse<SkillDefinition[]>> {
  const skills: SkillDefinition[] = [];
  const searchRoots = [
    path.join(workspacePath, '.agents', 'skills'),
    path.join(workspacePath, 'context', 'skills'),
    path.join(os.homedir(), '.gemini', 'config', 'skills'),
    path.join(os.homedir(), '.agents', 'skills')
  ];

  for (const root of searchRoots) {
    try {
      const exists = await fs.stat(root).then((s) => s.isDirectory()).catch(() => false);
      if (!exists) continue;

      const entries = await fs.readdir(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const skillFolder = path.join(root, entry.name);
        const skillMdPath = path.join(skillFolder, 'SKILL.md');

        try {
          const content = await fs.readFile(skillMdPath, 'utf-8');
          const meta = parseSkillFrontmatter(content);

          skills.push({
            id: entry.name,
            name: meta.name || entry.name,
            description: meta.description || 'Specialized Antigravity Agent Skill workflow',
            path: skillMdPath,
            content
          });
        } catch {
          // No SKILL.md found in folder
        }
      }
    } catch (err) {
      // Ignore unreadable directory
    }
  }

  return { success: true, data: skills };
}
