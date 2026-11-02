/**
 * Prompt E Step 2 — MCP management panel (Settings → "Model Context Servers").
 *
 * Talks to the live MCP client through the `mcpManage` namespace. Every dot,
 * tool list, and log line here is whatever the real JSON-RPC handshake
 * produced — a red dot means the server actually failed to answer, and the
 * enable/disable toggle connects/disconnects the underlying process for real.
 * The auto-routed recommendations section reads the same config format the
 * client consumes, so "Add" produces a server that shows up in this list.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Server, Plus, Trash2, RotateCw, X, ChevronDown, ChevronRight, Plug, Sparkles } from 'lucide-react';
import { useWorkspaceStore } from '../../state/workspace-store';
import { toast } from '../../state/toast-store';
import type { McpServerStatus, McpHealthState, McpTransport } from '../../../../shared/types/mcp';
import type { IpcResponse } from '../../../../preload/types';

function requireMcpApi(): NonNullable<typeof window.electronAPI.mcpManage> {
  const api = window.electronAPI.mcpManage;
  if (!api) throw new Error('MCP management API is not available in this build.');
  return api;
}

const HEALTH_DOT: Record<McpHealthState, { color: string; label: string }> = {
  connected: { color: '#22c55e', label: 'Connected' },
  connecting: { color: '#f59e0b', label: 'Connecting…' },
  error: { color: '#ef4444', label: 'Error' },
  idle: { color: '#64748b', label: 'Idle' },
  disabled: { color: '#475569', label: 'Disabled' }
};

interface RecommendedMcp {
  id: string;
  name: string;
  command: string;
  args: string[];
  description: string;
}

interface AddDraft {
  id: string;
  name: string;
  transport: McpTransport;
  command: string;
  args: string;
  url: string;
  projectScope: boolean;
  startEnabled: boolean;
}

const EMPTY_ADD: AddDraft = { id: '', name: '', transport: 'stdio', command: '', args: '', url: '', projectScope: true, startEnabled: true };

export const McpSettingsPanel: React.FC = () => {
  const workspacePath = useWorkspaceStore((s) => s.workspacePath);
  const [servers, setServers] = useState<McpServerStatus[]>([]);
  const [liveToolCount, setLiveToolCount] = useState(0);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [addDraft, setAddDraft] = useState<AddDraft>(EMPTY_ADD);
  const [adding, setAdding] = useState(false);
  const [recommendations, setRecommendations] = useState<RecommendedMcp[]>([]);
  // Two-step destructive confirm: id armed for removal, auto-disarms after a beat.
  const [armedRemove, setArmedRemove] = useState<string | null>(null);
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const bridgeAvailable = Boolean(window.electronAPI?.mcpManage);

  const applySnapshot = useCallback((statuses: McpServerStatus[]) => {
    setServers(statuses);
    setLiveToolCount(statuses.reduce((sum, s) => (s.health === 'connected' ? sum + s.tools.length : sum), 0));
  }, []);

  useEffect(() => {
    if (!workspacePath || !bridgeAvailable) return;
    let disposed = false;
    let removeEvent: (() => void) | null = null;
    setError('');
    void (async () => {
      try {
        const api = requireMcpApi();
        // Subscribe registers this window for pushed status events AND kicks a
        // background connect-all, so opening the panel shows true health.
        const res = (await api.subscribe(workspacePath)) as IpcResponse<McpServerStatus[]>;
        if (disposed) return;
        if (!res.success) {
          setError(res.error || 'Failed to load MCP servers.');
          return;
        }
        applySnapshot(res.data ?? []);
        removeEvent = api.onEvent((event) => {
          if (event.workspaceRoot === workspacePath) applySnapshot(event.servers);
        });
      } catch (reason) {
        if (!disposed) setError(reason instanceof Error ? reason.message : String(reason));
      }
    })();
    return () => {
      disposed = true;
      removeEvent?.();
      // Best-effort unsubscribe; the main side also unwinds on window destroy.
      void requireMcpApi().unsubscribe().catch(() => undefined);
    };
  }, [workspacePath, bridgeAvailable, applySnapshot]);

  useEffect(() => {
    if (!workspacePath || !window.electronAPI?.getRecommendedMCPs) return;
    void (async () => {
      try {
        const res = await window.electronAPI.getRecommendedMCPs(workspacePath);
        if (res.success && Array.isArray(res.data)) {
          setRecommendations(res.data.map((rec) => ({
            id: rec.id,
            name: rec.name,
            command: rec.command,
            args: rec.args,
            description: rec.description
          })));
        }
      } catch {
        // Recommendations are advisory; a failure here changes nothing visible.
      }
    })();
  }, [workspacePath]);

  const refresh = useCallback(async () => {
    if (!workspacePath) return;
    try {
      const res = (await requireMcpApi().list(workspacePath)) as IpcResponse<McpServerStatus[]>;
      if (res.success) applySnapshot(res.data ?? []);
      else setError(res.error || 'Failed to refresh MCP servers.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [workspacePath, applySnapshot]);

  const toggleEnabled = useCallback(async (server: McpServerStatus, enabled: boolean) => {
    if (!workspacePath) return;
    try {
      const res = (await requireMcpApi().setEnabled(workspacePath, server.id, enabled)) as IpcResponse<McpServerStatus>;
      if (!res.success) throw new Error(res.error || 'Toggle failed.');
      // The live-tool surface is the honest proof the toggle did something:
      void requireMcpApi().liveTools().then((live) => {
        if (live.success) setLiveToolCount(live.data?.length ?? 0);
      }).catch(() => undefined);
    } catch (reason) {
      toast.error('MCP toggle failed', reason instanceof Error ? reason.message : String(reason));
    }
  }, [workspacePath]);

  const reconnect = useCallback(async (server: McpServerStatus) => {
    if (!workspacePath) return;
    try {
      const res = (await requireMcpApi().reconnect(workspacePath, server.id)) as IpcResponse<McpServerStatus>;
      if (!res.success) throw new Error(res.error || 'Reconnect failed.');
    } catch (reason) {
      toast.error('MCP reconnect failed', reason instanceof Error ? reason.message : String(reason));
    }
  }, [workspacePath]);

  const removeServer = useCallback(async (server: McpServerStatus) => {
    if (!workspacePath) return;
    setArmedRemove(null);
    try {
      const res = (await requireMcpApi().remove(workspacePath, server.id, server.scope)) as IpcResponse<true>;
      if (!res.success) throw new Error(res.error || 'Remove failed.');
      toast.success('MCP server removed', `${server.id} removed from the ${server.scope} config.`);
      await refresh();
    } catch (reason) {
      toast.error('MCP remove failed', reason instanceof Error ? reason.message : String(reason));
    }
  }, [workspacePath, refresh]);

  const armRemove = useCallback((id: string) => {
    setArmedRemove(id);
    if (armTimerRef.current) clearTimeout(armTimerRef.current);
    armTimerRef.current = setTimeout(() => setArmedRemove(null), 5000);
  }, []);

  const addServer = useCallback(async (overrides?: Partial<AddDraft>) => {
    if (!workspacePath) return;
    const draft = overrides ? { ...addDraft, ...overrides } : addDraft;
    const id = draft.id.trim().toLowerCase().replace(/\s+/g, '-');
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) {
      toast.warning('Invalid server id', 'Use lowercase letters, digits, dots, dashes, or underscores.');
      return;
    }
    if (draft.transport === 'stdio' && !draft.command.trim()) {
      toast.warning('Command required', 'A stdio server needs the launch command (e.g. npx).');
      return;
    }
    if (draft.transport === 'sse' && !/^https?:\/\//i.test(draft.url.trim())) {
      toast.warning('Valid URL required', 'An SSE server needs an http(s) endpoint URL.');
      return;
    }
    setAdding(true);
    try {
      const api = requireMcpApi();
      const base = { workspacePath, id, transport: draft.transport, ...(draft.name.trim() ? { name: draft.name.trim() } : {}) };
      const res = (draft.transport === 'stdio'
        ? await api.addStdio({ ...base, transport: 'stdio', command: draft.command.trim(), args: draft.args.split(/\s+/).map((a) => a.trim()).filter(Boolean), projectScope: draft.projectScope, startEnabled: draft.startEnabled })
        : await api.addSse({ ...base, transport: 'sse', url: draft.url.trim(), projectScope: draft.projectScope, startEnabled: draft.startEnabled })
      ) as IpcResponse<McpServerStatus>;
      if (!res.success) throw new Error(res.error || 'Failed to add server.');
      toast.success('MCP server added', `${id} saved to the ${draft.projectScope ? 'project' : 'user global'} config.`);
      setAddOpen(false);
      setAddDraft(EMPTY_ADD);
      await refresh();
    } catch (reason) {
      toast.error('Add MCP server failed', reason instanceof Error ? reason.message : String(reason));
    } finally {
      setAdding(false);
    }
  }, [workspacePath, addDraft, refresh]);

  const configuredIds = useMemo(() => new Set(servers.map((s) => s.id)), [servers]);
  const openRecommendations = useMemo(() => recommendations.filter((r) => !configuredIds.has(r.id)), [recommendations, configuredIds]);

  if (!bridgeAvailable) {
    return (
      <div className="p-4 rounded-xl bg-amber-950/20 border border-amber-800/40 text-amber-300 text-xs">
        The MCP management bridge is unavailable in this window. Open the main application window to manage servers.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="p-4 rounded-xl bg-gradient-to-r from-indigo-950/40 via-slate-900 to-slate-900 border border-indigo-900/40">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-indigo-400">
            <Server size={20} />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-semibold text-white">Model Context Servers</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Live MCP clients in <code className="text-indigo-300">.ty-code/mcp_config.json</code>. Health comes from real handshakes —{' '}
              <strong className="text-indigo-300">{liveToolCount}</strong> tool{liveToolCount === 1 ? '' : 's'} live right now.
            </p>
          </div>
          <button
            type="button"
            onClick={() => { setAddOpen((v) => !v); setAddDraft(EMPTY_ADD); }}
            className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white flex items-center gap-1.5 shrink-0"
          >
            <Plus size={13} /> Add Server
          </button>
        </div>
      </div>

      {!workspacePath && (
        <div className="p-4 rounded-xl bg-amber-950/20 border border-amber-800/40 text-amber-300 text-xs">
          Open a workspace folder to manage project-scoped MCP servers. Global (user) servers still work here.
        </div>
      )}

      {error && (
        <div className="p-3 rounded-xl bg-rose-950/30 border border-rose-800/40 text-rose-300 text-xs flex items-center gap-2">
          <X size={13} /> {error}
        </div>
      )}

      {/* Add-server form */}
      {addOpen && (
        <div className="p-4 rounded-xl bg-[#14161f] border border-[#272938] space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300">Add MCP Server</h4>
            <button type="button" onClick={() => setAddOpen(false)} className="text-slate-500 hover:text-slate-300"><X size={14} /></button>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              value={addDraft.id}
              onChange={(e) => setAddDraft({ ...addDraft, id: e.target.value })}
              placeholder="id (e.g. my-tools)"
              className="flex-1 px-3 py-2 rounded-lg bg-[#0c0d12] border border-[#2c2e3e] text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono"
            />
            <input
              value={addDraft.name}
              onChange={(e) => setAddDraft({ ...addDraft, name: e.target.value })}
              placeholder="Display name (optional)"
              className="flex-1 px-3 py-2 rounded-lg bg-[#0c0d12] border border-[#2c2e3e] text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
            <select
              value={addDraft.transport}
              onChange={(e) => setAddDraft({ ...addDraft, transport: e.target.value as McpTransport })}
              className="px-2.5 py-2 rounded-lg bg-[#0c0d12] border border-[#2c2e3e] text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
            >
              <option value="stdio">stdio (spawn a process)</option>
              <option value="sse">HTTP + SSE (connect a URL)</option>
            </select>
          </div>
          {addDraft.transport === 'stdio' ? (
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                value={addDraft.command}
                onChange={(e) => setAddDraft({ ...addDraft, command: e.target.value })}
                placeholder="command (e.g. npx, python)"
                className="flex-1 px-3 py-2 rounded-lg bg-[#0c0d12] border border-[#2c2e3e] text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono"
              />
              <input
                value={addDraft.args}
                onChange={(e) => setAddDraft({ ...addDraft, args: e.target.value })}
                placeholder="arguments, space-separated (e.g. -y some-mcp-server)"
                className="flex-[2] px-3 py-2 rounded-lg bg-[#0c0d12] border border-[#2c2e3e] text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono"
              />
            </div>
          ) : (
            <input
              value={addDraft.url}
              onChange={(e) => setAddDraft({ ...addDraft, url: e.target.value })}
              placeholder="http(s)://… SSE endpoint URL"
              className="w-full px-3 py-2 rounded-lg bg-[#0c0d12] border border-[#2c2e3e] text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono"
            />
          )}
          <div className="flex items-center gap-4 text-[11px] text-slate-400 flex-wrap">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={addDraft.projectScope}
                onChange={(e) => setAddDraft({ ...addDraft, projectScope: e.target.checked })}
              />
              Project config (.ty-code in workspace)
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={addDraft.startEnabled}
                onChange={(e) => setAddDraft({ ...addDraft, startEnabled: e.target.checked })}
              />
              Enable and connect now
            </label>
            <button
              type="button"
              onClick={() => void addServer()}
              disabled={adding}
              className="ml-auto px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-medium text-white flex items-center gap-1.5"
            >
              <Plug size={13} /> {adding ? 'Adding…' : 'Add Server'}
            </button>
          </div>
        </div>
      )}

      {/* Server list */}
      <div className="space-y-2">
        {servers.length === 0 ? (
          <div className="p-8 rounded-xl bg-[#10121a]/50 border border-[#202230] text-center">
            <Server size={26} className="mx-auto mb-2 text-slate-600" />
            <h5 className="text-xs font-medium text-slate-300">No MCP servers configured</h5>
            <p className="text-[11px] text-slate-500 mt-1">
              Add one with “Add Server”, or pick from the auto-routing recommendations below.
            </p>
          </div>
        ) : (
          servers.map((server) => {
            const dot = HEALTH_DOT[server.health];
            const isOpen = Boolean(expanded[server.id]);
            return (
              <div key={`${server.scope}:${server.id}`} className="rounded-xl bg-[#12141c] border border-[#202230] overflow-hidden">
                <div className="flex items-center gap-3 p-3">
                  <span
                    title={dot.label}
                    className={server.health === 'connecting' ? 'animate-pulse' : ''}
                    style={{ width: 9, height: 9, borderRadius: 9999, background: dot.color, flexShrink: 0 }}
                  />
                  <button
                    type="button"
                    onClick={() => setExpanded((prev) => ({ ...prev, [server.id]: !prev[server.id] }))}
                    className="min-w-0 flex-1 flex items-center gap-2 text-left"
                  >
                    {isOpen ? <ChevronDown size={13} className="text-slate-500 shrink-0" /> : <ChevronRight size={13} className="text-slate-500 shrink-0" />}
                    <span className="text-xs font-medium text-white truncate">{server.name || server.id}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-700/50 text-slate-300 border border-slate-600/40 shrink-0">{server.transport}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800/60 text-slate-400 border border-slate-700/40 shrink-0">{server.scope}</span>
                    {server.tools.length > 0 && (
                      <span className="text-[10px] text-slate-500 shrink-0">{server.tools.length} tools</span>
                    )}
                  </button>
                  {server.health !== 'disabled' && (
                    <button
                      type="button"
                      onClick={() => void reconnect(server)}
                      title="Reconnect"
                      className="p-1.5 rounded-lg hover:bg-slate-700/50 text-slate-400 hover:text-slate-200 transition-colors shrink-0"
                    >
                      <RotateCw size={13} />
                    </button>
                  )}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!server.disabled}
                    onClick={() => void toggleEnabled(server, server.disabled)}
                    title={server.disabled ? 'Enable and connect' : 'Disable and disconnect'}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors shrink-0"
                    style={server.disabled
                      ? { background: 'rgba(100,116,139,0.12)', borderColor: 'rgba(100,116,139,0.35)', color: '#94a3b8' }
                      : { background: 'rgba(34,197,94,0.12)', borderColor: 'rgba(34,197,94,0.35)', color: '#4ade80' }}
                  >
                    {server.disabled ? 'Disabled' : 'Enabled'}
                  </button>
                  <button
                    type="button"
                    onClick={() => (armedRemove === server.id ? void removeServer(server) : armRemove(server.id))}
                    title={armedRemove === server.id ? 'Click again to confirm removal' : 'Remove server'}
                    className="px-2 py-1 rounded-lg text-[11px] font-medium border transition-colors shrink-0"
                    style={armedRemove === server.id
                      ? { background: 'rgba(239,68,68,0.2)', borderColor: 'rgba(239,68,68,0.5)', color: '#fca5a5' }
                      : { background: 'transparent', borderColor: 'rgba(100,116,139,0.3)', color: '#94a3b8' }}
                  >
                    {armedRemove === server.id ? 'Confirm?' : <Trash2 size={13} />}
                  </button>
                </div>
                <div className="px-3 pb-2 text-[10px] text-slate-500 font-mono truncate">
                  {server.target}{server.args.length > 0 ? ` ${server.args.join(' ')}` : ''}
                </div>
                {server.error && (
                  <div className="mx-3 mb-2 px-2.5 py-1.5 rounded-lg bg-rose-950/30 border border-rose-800/40 text-[11px] text-rose-300 break-all">
                    {server.error}
                  </div>
                )}
                {isOpen && (
                  <div className="border-t border-[#202230] p-3 space-y-3">
                    <div>
                      <h5 className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Tools (from tools/list)</h5>
                      {server.tools.length === 0 ? (
                        <p className="text-[11px] text-slate-500">No tools reported{server.health === 'connected' ? '.' : ' — server is not connected.'}.</p>
                      ) : (
                        <div className="space-y-1">
                          {server.tools.map((tool) => (
                            <div key={tool.name} className="flex items-start gap-2 px-2.5 py-1.5 rounded-lg bg-[#0c0d12] border border-[#242636]">
                              <span className="text-[11px] font-mono text-indigo-300 shrink-0">{tool.name}</span>
                              {tool.description && <span className="text-[11px] text-slate-500 line-clamp-2">{tool.description}</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div>
                      <h5 className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Log tail (stderr)</h5>
                      {server.log.length === 0 ? (
                        <p className="text-[11px] text-slate-500">No output captured yet.</p>
                      ) : (
                        <pre className="max-h-36 overflow-auto px-2.5 py-2 rounded-lg bg-[#0c0d12] border border-[#242636] text-[10px] leading-relaxed text-slate-400 font-mono whitespace-pre-wrap break-all">
                          {server.log.join('\n')}
                        </pre>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Auto-routing recommendations */}
      {openRecommendations.length > 0 && (
        <div className="p-4 rounded-xl bg-[#14161f] border border-[#272938] space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles size={15} className="text-amber-400" />
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300">Auto-Routing Recommendations</h4>
          </div>
          <p className="text-[11px] text-slate-500">
            The context router suggests these stdio servers for this project's stack. Adding writes them to the project config.
          </p>
          <div className="space-y-1.5">
            {openRecommendations.map((rec) => (
              <div key={rec.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[#0c0d12] border border-[#242636]">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-white">{rec.name}</span>
                    <span className="text-[10px] text-slate-500 font-mono truncate">{rec.command} {rec.args.join(' ')}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 truncate mt-0.5">{rec.description}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void addServer({ id: rec.id, name: rec.name, transport: 'stdio', command: rec.command, args: rec.args.join(' '), projectScope: true, startEnabled: true })}
                  className="px-2.5 py-1 rounded-lg bg-indigo-600/80 hover:bg-indigo-500 text-[11px] font-medium text-white flex items-center gap-1 shrink-0"
                >
                  <Plus size={12} /> Add
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default McpSettingsPanel;
