import fs from 'fs/promises';
import path from 'path';
import { createReadStream } from 'fs';
import readline from 'readline';

export interface FileInfo {
  totalLines: number;
  fileSize: number;
  path: string;
}

export interface ChunkReadResult {
  content: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  isComplete: boolean;
}

const CHUNK_SIZE = 200;
const LARGE_FILE_THRESHOLD = 500;

export class SmartFileReader {
  private readonly workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = path.resolve(workspaceRoot);
  }

  private resolveSafePath(relativePath: string): string {
    const absolutePath = path.resolve(this.workspaceRoot, relativePath);
    if (!absolutePath.startsWith(this.workspaceRoot)) {
      throw new Error(`Security Exception: Path "${relativePath}" attempts to escape workspace.`);
    }
    return absolutePath;
  }

  async getFileInfo(filePath: string): Promise<FileInfo> {
    const absolutePath = this.resolveSafePath(filePath);
    const stats = await fs.stat(absolutePath);
    let totalLines = 0;
    const stream = createReadStream(absolutePath, { encoding: 'utf-8', highWaterMark: 64 * 1024 });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const _line of rl) {
      totalLines++;
    }
    return { totalLines, fileSize: stats.size, path: filePath };
  }

  async readFileInChunks(filePath: string, startLine: number, endLine: number): Promise<ChunkReadResult> {
    if (startLine < 1) startLine = 1;
    const absolutePath = this.resolveSafePath(filePath);

    let totalLines = 0;
    const stream = createReadStream(absolutePath, { encoding: 'utf-8', highWaterMark: 64 * 1024 });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    const lines: string[] = [];
    for await (const line of rl) {
      totalLines++;
      if (totalLines >= startLine && totalLines <= endLine) {
        lines.push(line);
      } else if (totalLines > endLine) {
        break;
      }
    }

    const actualEndLine = Math.min(endLine, totalLines);
    const formatted = lines.map((line, index) => `${startLine + index}: ${line}`).join('\n');

    return {
      content: formatted,
      startLine,
      endLine: actualEndLine,
      totalLines,
      isComplete: actualEndLine === totalLines
    };
  }

  async readEntireFile(filePath: string): Promise<ChunkReadResult> {
    const info = await this.getFileInfo(filePath);
    if (info.totalLines <= LARGE_FILE_THRESHOLD) {
      return this.readFileInChunks(filePath, 1, info.totalLines);
    }

    const chunks: string[] = [];
    let currentStart = 1;
    let isComplete = false;

    while (!isComplete) {
      const currentEnd = Math.min(currentStart + CHUNK_SIZE - 1, info.totalLines);
      const result = await this.readFileInChunks(filePath, currentStart, currentEnd);
      chunks.push(result.content);
      isComplete = result.isComplete;
      currentStart = currentEnd + 1;
    }

    return {
      content: chunks.join('\n'),
      startLine: 1,
      endLine: info.totalLines,
      totalLines: info.totalLines,
      isComplete: true
    };
  }

  static shouldChunk(fileInfo: FileInfo): boolean {
    return fileInfo.totalLines > LARGE_FILE_THRESHOLD;
  }

  static getChunkRanges(totalLines: number): Array<{ startLine: number; endLine: number }> {
    const ranges: Array<{ startLine: number; endLine: number }> = [];
    let current = 1;
    while (current <= totalLines) {
      ranges.push({ startLine: current, endLine: Math.min(current + CHUNK_SIZE - 1, totalLines) });
      current += CHUNK_SIZE;
    }
    return ranges;
  }
}

export function createSmartFileReader(workspaceRoot: string): SmartFileReader {
  return new SmartFileReader(workspaceRoot);
}