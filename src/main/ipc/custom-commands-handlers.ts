/**
 * Prompt E (Step 3) — custom command IPC.
 *
 * Two read-only-by-design channels: list the project + user command entries,
 * and render one with argument substitution. Writing command files stays a
 * plain filesystem edit (they are git-shareable Markdown), same philosophy as
 * the rules engine.
 */

import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import {
  CUSTOM_COMMAND_CHANNELS,
  CustomCommandRenderRequestSchema,
  CustomCommandsListRequestSchema,
  type CustomCommand,
  type CustomCommandRenderResult
} from '../../shared/types/custom-commands';
import { customCommandService } from '../services/knowledge/custom-command-service';

interface IpcResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

interface HandlerDeps {
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean;
}

export function registerCustomCommandHandlers(deps: HandlerDeps): void {
  ipcMain.handle(
    CUSTOM_COMMAND_CHANNELS.list,
    async (event, payload: unknown): Promise<IpcResponse<CustomCommand[]>> => {
      if (!deps.isTrustedSender(event)) return { success: false, error: 'untrusted sender' };
      const parsed = CustomCommandsListRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return { success: false, error: `customCommands:list: ${parsed.error.issues[0]?.message ?? 'invalid'}` };
      }
      try {
        return { success: true, data: await customCommandService.list(parsed.data.workspacePath) };
      } catch (err) {
        return { success: false, error: `customCommands list failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    }
  );

  ipcMain.handle(
    CUSTOM_COMMAND_CHANNELS.render,
    async (event, payload: unknown): Promise<IpcResponse<CustomCommandRenderResult>> => {
      if (!deps.isTrustedSender(event)) return { success: false, error: 'untrusted sender' };
      const parsed = CustomCommandRenderRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return { success: false, error: `customCommands:render: ${parsed.error.issues[0]?.message ?? 'invalid'}` };
      }
      try {
        const prompt = await customCommandService.render(
          parsed.data.workspacePath,
          parsed.data.name,
          parsed.data.rawArgs,
          parsed.data.args
        );
        return { success: true, data: { name: parsed.data.name, prompt } };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );
}
