import fs from 'fs/promises';
import path from 'path';
import type { IpcResponse } from '../../preload/types';

export interface ChatFileContext {
  path: string;
  name: string;
  mimeType: string;
  content: string;
  truncated: boolean;
  totalLines: number;
}

export interface ReadFileForContextOptions {
  maxLines?: number;
}

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml'
};

const DEFAULT_MAX_LINES = 200;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function isInsideWorkspace(targetPath: string, workspaceRoot: string): boolean {
  const relative = path.relative(workspaceRoot, targetPath);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function resolveInsideWorkspace(targetPath: string, workspaceRoot: string): Promise<string> {
  if (!targetPath || typeof targetPath !== 'string') throw new Error('A valid file path is required.');
  const root = await fs.realpath(path.resolve(workspaceRoot));
  const resolved = path.resolve(root, targetPath);
  if (!isInsideWorkspace(resolved, root) || resolved === root) {
    throw new Error('Read operations must target a path inside the active workspace.');
  }
  const real = await fs.realpath(resolved);
  if (!isInsideWorkspace(real, root)) throw new Error('File path resolves outside the active workspace.');
  return real;
}

export async function readFileForContext(
  filePath: string,
  workspaceRoot = process.cwd(),
  options: ReadFileForContextOptions = {}
): Promise<IpcResponse<ChatFileContext>> {
  try {
    const safePath = await resolveInsideWorkspace(filePath, workspaceRoot);
    const name = path.basename(safePath);
    const ext = path.extname(safePath).toLowerCase();
    const mimeType = IMAGE_MIME_BY_EXT[ext] || '';

    if (mimeType) {
      const stat = await fs.stat(safePath);
      if (stat.size > MAX_IMAGE_BYTES) {
        return { success: false, error: `Image is too large to attach (${Math.round(stat.size / (1024 * 1024))}MB). Limit is 10MB.` };
      }
      const buffer = await fs.readFile(safePath);
      const base64 = buffer.toString('base64');
      return {
        success: true,
        data: {
          path: safePath,
          name,
          mimeType,
          content: `data:${mimeType};base64,${base64}`,
          truncated: false,
          totalLines: 0
        }
      };
    }

    const maxLines = Math.max(
      1,
      Math.min(
        2_000,
        Number.isFinite(options.maxLines) && (options.maxLines as number) > 0 ? Math.floor(options.maxLines as number) : DEFAULT_MAX_LINES
      )
    );
    const raw = await fs.readFile(safePath, 'utf-8');
    const lines = raw.split(/\r\n|\n|\r/);
    const capped = lines.slice(0, maxLines).join('\n');
    return {
      success: true,
      data: {
        path: safePath,
        name,
        mimeType: 'text/plain',
        content: capped,
        truncated: lines.length > maxLines,
        totalLines: lines.length
      }
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
