/**
 * Ty-Code Prompt Assembler — In-Memory Telemetry Ring Buffer
 *
 * ZERO TELEMETRY GUARANTEE:
 * This module holds an in-memory ring buffer (capacity 50) of recent AssemblyResult
 * snapshots keyed by taskId for local developer observability.
 *
 * Constraints:
 * - Pure RAM only: NO file system imports (fs/fsp), NO network imports (http/https/net/tls).
 * - Nothing is persisted to disk and nothing leaves this machine.
 * - Snapshots are evicted FIFO once the capacity of 50 is reached.
 *
 * Brand: Ty-Code
 */

import { EventEmitter } from 'events';
import type { AssemblyResult } from './schemas';

export const MAX_RING_CAPACITY = 50;

export const assemblyEmitter = new EventEmitter();
// Increase max listeners for multiple windows/views in local development
assemblyEmitter.setMaxListeners(50);

interface RingEntry {
  taskId: string;
  result: AssemblyResult;
  timestamp: number;
}

const ringBuffer: RingEntry[] = [];
const taskIndex = new Map<string, AssemblyResult>();

/**
 * Records an AssemblyResult snapshot into the ring buffer.
 * Evicts the oldest entry if buffer exceeds capacity of 50.
 * Emits 'assembly' on the module assemblyEmitter.
 */
export function recordAssembly(result: AssemblyResult): void {
  if (!result || !result.taskId) return;

  const entry: RingEntry = {
    taskId: result.taskId,
    result,
    timestamp: Date.now()
  };

  // If already exists, update in-place or remove old position
  const existingIdx = ringBuffer.findIndex((e) => e.taskId === result.taskId);
  if (existingIdx >= 0) {
    ringBuffer.splice(existingIdx, 1);
  }

  // FIFO eviction
  if (ringBuffer.length >= MAX_RING_CAPACITY) {
    const evicted = ringBuffer.shift();
    if (evicted) {
      taskIndex.delete(evicted.taskId);
    }
  }

  ringBuffer.push(entry);
  taskIndex.set(result.taskId, result);

  try {
    assemblyEmitter.emit('assembly', result);
  } catch (err) {
    console.warn('[PROMPT-TELEMETRY] Failed emitting assembly event:', err);
  }
}

/**
 * Returns all recorded assembly snapshots in reverse chronological order (newest first).
 */
export function getAssemblyHistory(): AssemblyResult[] {
  return [...ringBuffer].reverse().map((e) => e.result);
}

/**
 * Looks up a specific assembly snapshot by taskId.
 */
export function getAssemblyInfo(taskId: string): AssemblyResult | null {
  if (!taskId) return null;
  return taskIndex.get(taskId) || null;
}

/**
 * Clears the in-memory ring buffer.
 */
export function clearAssemblyHistory(): void {
  ringBuffer.length = 0;
  taskIndex.clear();
}
