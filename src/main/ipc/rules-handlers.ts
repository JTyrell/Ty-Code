/**
 * Prompt C Step 2 — Rules IPC channels.
 *
 * Zod-guarded handlers backing the Settings Rules UI: list, read, save, delete and
 * the "which rules fire for this file" tester. All operations are strictly local to
 * the workspace's `.tycode/rules/` directory.
 */

import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import {
  RULE_CHANNELS,
  RulesListRequestSchema,
  ReadRuleRequestSchema,
  SaveRuleRequestSchema,
  DeleteRuleRequestSchema,
  TestRuleRequestSchema,
  type RuleMeta,
  type RuleFile,
  type RuleTestResult
} from '../../shared/types/rules';
import { rulesService } from '../services/knowledge/rules-service';

interface IpcResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

interface HandlerDeps {
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean;
}

function untrusted<T = unknown>(): IpcResponse<T> {
  return { success: false, error: 'untrusted sender' };
}

function fail<T = unknown>(error: string): IpcResponse<T> {
  return { success: false, error };
}

async function guardJson<T>(label: string, fn: () => Promise<T>): Promise<IpcResponse<T>> {
  try {
    return { success: true, data: await fn() } as IpcResponse<T>;
  } catch (err) {
    return { success: false, error: `${label}: ${err instanceof Error ? err.message : String(err)}` } as IpcResponse<T>;
  }
}

export function registerRulesHandlers(deps: HandlerDeps): void {
  ipcMain.handle(
    RULE_CHANNELS.list,
    async (event, payload: unknown): Promise<IpcResponse<RuleMeta[]>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = RulesListRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`rules:list: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      return guardJson('listing rules failed', () => rulesService.list(parsed.data.workspaceRoot));
    }
  );

  ipcMain.handle(
    RULE_CHANNELS.read,
    async (event, payload: unknown): Promise<IpcResponse<RuleFile | null>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = ReadRuleRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`rules:read: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      return guardJson('reading rule failed', () => rulesService.read(parsed.data.workspaceRoot, parsed.data.name));
    }
  );

  ipcMain.handle(
    RULE_CHANNELS.save,
    async (event, payload: unknown): Promise<IpcResponse<RuleMeta>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = SaveRuleRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`rules:save: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      return guardJson('saving rule failed', () => rulesService.save(parsed.data.workspaceRoot, parsed.data));
    }
  );

  ipcMain.handle(
    RULE_CHANNELS.remove,
    async (event, payload: unknown): Promise<IpcResponse<boolean>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = DeleteRuleRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`rules:remove: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      return guardJson('deleting rule failed', () => rulesService.remove(parsed.data.workspaceRoot, parsed.data.name));
    }
  );

  ipcMain.handle(
    RULE_CHANNELS.test,
    async (event, payload: unknown): Promise<IpcResponse<RuleTestResult>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = TestRuleRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`rules:test: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      return guardJson('testing rules failed', () => rulesService.testFile(parsed.data.workspaceRoot, parsed.data.filePath));
    }
  );
}
