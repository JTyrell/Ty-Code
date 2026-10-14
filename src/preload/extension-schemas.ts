import { z } from 'zod';

export const EXTENSION_RPC_MAX_BYTES = 256 * 1024;
export const EXTENSION_RPC_MAX_CONTENT_CHARS = 50_000;
export const EXTENSION_RPC_MAX_IN_FLIGHT = 32;
export const EXTENSION_RPC_TIMEOUT_MS = 8_000;
export const EXTENSION_WORKER_HEARTBEAT_MS = 5_000;
export const EXTENSION_WORKER_WATCHDOG_MS = 15_000;

const slug = z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/, 'Use lowercase letters, digits, and hyphens.');
export const ExtensionIdSchema = z.string().min(3).max(129).regex(/^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/, 'Extension IDs must be publisher.name slugs.');

export const ExtensionCapabilitySchema = z.enum([
  'workspace.fs.read',
  'workspace.fs.write',
  'commands.register',
  'editor.read',
  'editor.edit',
  'languages.completion',
  'languages.hover',
  'window.messages',
  'window.input',
  'terminal.open',
  'agent.request',
  'git.read',
  'webviews.create'
]);
export type ExtensionCapability = z.infer<typeof ExtensionCapabilitySchema>;

const ExtensionCommandSchema = z.object({
  command: z.string().min(3).max(160).regex(/^[a-z0-9][a-zA-Z0-9.-]*$/),
  title: z.string().min(1).max(160),
  category: z.string().max(80).optional(),
  icon: z.string().max(200).optional()
}).strict();

const ConfigurationPropertySchema = z.object({
  type: z.enum(['boolean', 'string', 'number']),
  default: z.union([z.boolean(), z.string().max(500), z.number().finite()]).optional(),
  description: z.string().max(500).optional(),
  enum: z.array(z.union([z.boolean(), z.string().max(120), z.number().finite()])).max(50).optional()
}).strict();

export const ExtensionManifestSchema = z.object({
  name: slug,
  publisher: slug,
  version: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/, 'Version must be semantic versioning.'),
  displayName: z.string().max(160).optional(),
  description: z.string().max(2_000).optional(),
  main: z.string().max(240).refine((value) => !value.includes('..') && !value.startsWith('/') && !value.startsWith('\\'), 'main must be a safe relative path.').optional(),
  icon: z.string().max(500).optional(),
  categories: z.array(z.string().min(1).max(60)).max(20).optional(),
  capabilities: z.array(ExtensionCapabilitySchema).max(20).optional(),
  engines: z.object({ vscode: z.string().max(100).optional(), 'ty-code': z.string().max(100).optional(), 'ty-claude': z.string().max(100).optional() }).strict().optional(),
  activationEvents: z.array(z.string().max(120)).max(50).optional(),
  contributes: z.object({
    commands: z.array(ExtensionCommandSchema).max(100).optional(),
    languages: z.array(z.object({
      id: slug,
      aliases: z.array(z.string().max(80)).max(20).optional(),
      extensions: z.array(z.string().regex(/^\.[a-z0-9]+$/i)).max(30).optional(),
      configuration: z.string().max(240).optional()
    }).strict()).max(50).optional(),
    configuration: z.object({
      title: z.string().max(160).optional(),
      properties: z.record(z.string().max(160), ConfigurationPropertySchema).optional()
    }).strict().optional(),
    keybindings: z.array(z.object({
      command: z.string().max(160), key: z.string().max(100), mac: z.string().max(100).optional(), when: z.string().max(200).optional()
    }).strict()).max(100).optional()
  }).strict().optional()
}).strict().superRefine((manifest, context) => {
  const commandPrefix = `${manifest.publisher}.${manifest.name}.`;
  for (const command of manifest.contributes?.commands || []) {
    if (!command.command.startsWith(commandPrefix)) {
      context.addIssue({ code: 'custom', path: ['contributes', 'commands'], message: `Command "${command.command}" must start with "${commandPrefix}".` });
    }
  }
  for (const [key, property] of Object.entries(manifest.contributes?.configuration?.properties || {})) {
    if (property.default !== undefined && typeof property.default !== property.type) {
      context.addIssue({ code: 'custom', path: ['contributes', 'configuration', 'properties', key, 'default'], message: 'Default value must match the declared setting type.' });
    }
    if (property.enum && property.default !== undefined && !property.enum.includes(property.default)) {
      context.addIssue({ code: 'custom', path: ['contributes', 'configuration', 'properties', key, 'default'], message: 'Default value must be one of the enum values.' });
    }
  }
});

export const ExtensionMetadataSchema = z.object({
  id: ExtensionIdSchema,
  namespace: slug,
  name: slug,
  displayName: z.string().min(1).max(160),
  description: z.string().max(2_000),
  version: ExtensionManifestSchema.shape.version,
  iconUrl: z.string().url().refine((value) => {
    try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'open-vsx.org'; } catch { return false; }
  }).optional(),
  downloadCount: z.number().finite().nonnegative().optional(),
  rating: z.number().finite().min(0).max(5).optional(),
  publishedDate: z.string().max(80).optional(),
  repository: z.string().url().refine((value) => { try { return new URL(value).protocol === 'https:'; } catch { return false; } }).optional(),
  downloadUrl: z.string().url().refine((value) => {
    try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'open-vsx.org'; } catch { return false; }
  }).optional(),
  categories: z.array(z.string().min(1).max(60)).max(20).optional()
}).strict().superRefine((metadata, context) => {
  if (metadata.id !== `${metadata.namespace}.${metadata.name}`) {
    context.addIssue({ code: 'custom', path: ['id'], message: 'Extension ID must match namespace and name.' });
  }
});

export const ExtensionRpcMethodSchema = z.enum([
  'host.activate', 'host.execute-command', 'host.deactivate', 'host.ping',
  'capability.workspace.read-file', 'capability.workspace.write-file',
  'capability.editor.get-active-document', 'capability.editor.apply-active-edit',
  'capability.window.show-message', 'capability.window.show-input', 'capability.terminal.open', 'capability.agent.request',
  'capability.git.refresh', 'capability.git.copy-remote-url'
]);
export type ExtensionRpcMethod = z.infer<typeof ExtensionRpcMethodSchema>;

const RpcEnvelopeBase = z.object({
  v: z.literal(1),
  id: z.string().uuid(),
  extensionId: ExtensionIdSchema,
  nonce: z.string().uuid()
});
export const ExtensionRpcRequestSchema = RpcEnvelopeBase.extend({
  kind: z.literal('request'), method: ExtensionRpcMethodSchema, params: z.unknown()
}).strict();

export const ExtensionRpcResultSchemas: Record<ExtensionRpcMethod, z.ZodType> = {
  'host.activate': z.boolean(),
  'host.execute-command': z.unknown(),
  'host.deactivate': z.boolean(),
  'host.ping': z.boolean(),
  'capability.workspace.read-file': z.string().max(200 * 1024),
  'capability.workspace.write-file': z.union([z.undefined(), z.null()]),
  'capability.editor.get-active-document': z.union([z.null(), z.object({ uri: z.string().max(2_000), fileName: z.string().max(500), languageId: z.string().max(100), lineCount: z.number().int().nonnegative(), text: z.string().max(EXTENSION_RPC_MAX_CONTENT_CHARS) }).strict()]),
  'capability.editor.apply-active-edit': z.boolean(),
  'capability.window.show-message': z.union([z.undefined(), z.null()]),
  'capability.window.show-input': z.string().max(2_000).optional(),
  'capability.terminal.open': z.union([z.undefined(), z.null()]),
  'capability.agent.request': z.union([z.undefined(), z.null()]),
  'capability.git.refresh': z.union([z.undefined(), z.null()]),
  'capability.git.copy-remote-url': z.string().max(2_000)
};

export const ExtensionRpcResponseSchema = z.discriminatedUnion('ok', [
  RpcEnvelopeBase.extend({ kind: z.literal('response'), method: ExtensionRpcMethodSchema, ok: z.literal(true), result: z.unknown() })
    .strict().superRefine((message, context) => {
      const result = ExtensionRpcResultSchemas[message.method].safeParse(message.result);
      if (!result.success) context.addIssue({ code: 'custom', path: ['result'], message: `Invalid result for ${message.method}.` });
    }),
  RpcEnvelopeBase.extend({ kind: z.literal('response'), method: ExtensionRpcMethodSchema, ok: z.literal(false), error: z.string().min(1).max(2_000) }).strict()
]);
export const ExtensionRpcEventSchema = z.discriminatedUnion('method', [
  RpcEnvelopeBase.extend({
    kind: z.literal('event'), method: z.literal('runtime.ready'), params: z.object({}).strict()
  }).strict(),
  RpcEnvelopeBase.extend({
    kind: z.literal('event'), method: z.literal('command.register'),
    params: z.object({ commandId: z.string().min(3).max(160), title: z.string().min(1).max(160) }).strict()
  }).strict()
]);
export const ExtensionRpcMessageSchema = z.discriminatedUnion('kind', [ExtensionRpcRequestSchema, ExtensionRpcResponseSchema, ExtensionRpcEventSchema]);
export type ExtensionRpcMessage = z.infer<typeof ExtensionRpcMessageSchema>;
export type ExtensionRpcRequest = z.infer<typeof ExtensionRpcRequestSchema>;
export type ExtensionRpcResponse = z.infer<typeof ExtensionRpcResponseSchema>;
export type ExtensionRpcEvent = z.infer<typeof ExtensionRpcEventSchema>;

const idParams = z.object({ extensionId: ExtensionIdSchema }).strict();
export const ExtensionCapabilityRequestSchema = z.object({
  extensionId: ExtensionIdSchema,
  capability: ExtensionCapabilitySchema,
  method: z.enum(['workspace.read-file', 'workspace.write-file']),
  relativePath: z.string().min(1).max(1_000),
  content: z.string().max(EXTENSION_RPC_MAX_CONTENT_CHARS).optional()
}).strict().superRefine((request, context) => {
  const normalizedPath = request.relativePath.replace(/\\/g, '/');
  if (normalizedPath.startsWith('/') || /^[a-z]:/i.test(normalizedPath) || normalizedPath.split('/').some((part) => part === '.' || part === '..' || /^\.env(?:\.|$)/i.test(part))) {
    context.addIssue({ code: 'custom', path: ['relativePath'], message: 'Workspace paths must be safe, relative, and non-sensitive.' });
  }
  const expected = request.method === 'workspace.read-file' ? 'workspace.fs.read' : 'workspace.fs.write';
  if (request.capability !== expected) context.addIssue({ code: 'custom', path: ['capability'], message: 'Capability does not match the requested operation.' });
  if (request.method === 'workspace.write-file' && request.content === undefined) context.addIssue({ code: 'custom', path: ['content'], message: 'Write operations require content.' });
  if (request.method === 'workspace.read-file' && request.content !== undefined) context.addIssue({ code: 'custom', path: ['content'], message: 'Read operations cannot include content.' });
});

export const ExtensionRpcParamsSchema: Record<ExtensionRpcMethod, z.ZodType> = {
  'host.activate': z.object({ extensionId: ExtensionIdSchema, manifest: ExtensionManifestSchema, capabilities: z.array(ExtensionCapabilitySchema).max(20) }).strict(),
  'host.execute-command': z.object({ extensionId: ExtensionIdSchema, commandId: z.string().min(3).max(160), args: z.array(z.unknown()).max(30) }).strict(),
  'host.deactivate': idParams,
  'host.ping': z.object({}).strict(),
  'capability.workspace.read-file': z.object({ relativePath: z.string().min(1).max(1_000) }).strict(),
  'capability.workspace.write-file': z.object({ relativePath: z.string().min(1).max(1_000), content: z.string().max(EXTENSION_RPC_MAX_CONTENT_CHARS) }).strict(),
  'capability.editor.get-active-document': z.object({}).strict(),
  'capability.editor.apply-active-edit': z.object({ content: z.string().max(EXTENSION_RPC_MAX_CONTENT_CHARS) }).strict(),
  'capability.window.show-message': z.object({ message: z.string().max(2_000) }).strict(),
  'capability.window.show-input': z.object({ prompt: z.string().max(500), value: z.string().max(2_000).optional() }).strict(),
  'capability.terminal.open': z.object({}).strict(),
  'capability.agent.request': z.object({ prompt: z.string().min(1).max(8_000) }).strict(),
  'capability.git.refresh': z.object({}).strict(),
  'capability.git.copy-remote-url': z.object({}).strict()
};

export function parseExtensionRpcMessage(input: unknown): ExtensionRpcMessage {
  const serialized = JSON.stringify(input);
  if (serialized === undefined || new TextEncoder().encode(serialized).byteLength > EXTENSION_RPC_MAX_BYTES) {
    throw new Error('Extension RPC message exceeds the 256 KiB limit.');
  }
  return ExtensionRpcMessageSchema.parse(input);
}

export function parseExtensionRpcParams(method: ExtensionRpcMethod, params: unknown): unknown {
  return ExtensionRpcParamsSchema[method].parse(params);
}

export function validateExtensionSettings(manifest: z.infer<typeof ExtensionManifestSchema>, settings: Record<string, unknown>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const properties = manifest.contributes?.configuration?.properties || {};
  if (Object.keys(settings).length > 100) return { valid: false, errors: ['At most 100 settings may be stored for an extension.'] };
  for (const [key, value] of Object.entries(settings)) {
    const definition = properties[key];
    if (!definition) { errors.push(`Unknown setting "${key}".`); continue; }
    if (typeof value !== definition.type || (typeof value === 'number' && !Number.isFinite(value))) {
      errors.push(`Setting "${key}" must be a ${definition.type}.`); continue;
    }
    if (definition.enum && !definition.enum.includes(value as never)) errors.push(`Setting "${key}" is not an allowed value.`);
  }
  return { valid: errors.length === 0, errors };
}
