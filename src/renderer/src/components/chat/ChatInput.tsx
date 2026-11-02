import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AtSign, BookOpen, FileDiff, FileText, FolderOpen, GitCommit, Image as ImageIcon, Mic, Plus, ScrollText, Send, Slash, Square, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { FlatFileNodeEntry, GitCommitInfo } from '../../../../preload/types';
import type { WikiSectionId, WikiSectionMeta } from '../../../../shared/types/wiki';
import type { RuleMeta } from '../../../../shared/types/rules';
import { useWorkspaceStore } from '../../state/workspace-store';
import { useChatInputStore, MAX_ATTACHMENTS, type Attachment } from '../../state/chat-input-store';
import { toast } from '../../state/toast-store';

const TY_CODE_FILE_MIME = 'application/x-ty-code-file-path';

const FALLBACK_IMAGE_BYTES = 6 * 1024 * 1024;
const FALLBACK_TEXT_BYTES = 512 * 1024;

const TARGET_VOICE_SAMPLE_RATE = 16_000;
const VOICE_MAX_RECORDING_MS = 90_000;

const SLASH_COMMANDS: Array<{ command: string; description: string; template: string }> = [
  { command: '/sync', description: 'Rescan workspace and sync stack profile', template: '/sync' },
  { command: '/quest', description: 'Delegate a long-horizon quest (draft spec → approve → run in isolated worktree)', template: '/quest ' },
  { command: '/review', description: 'Review focused code for bugs and security issues', template: '/review ' },
  { command: '/test', description: 'Generate tests with happy, edge, and error coverage', template: '/test ' },
  { command: '/refactor', description: 'Refactor while preserving behavior', template: '/refactor ' }
];

interface ChatInputProps {
  input: string;
  inputRef: React.RefObject<HTMLTextAreaElement>;
  onInputChange: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSubmit: (event?: React.FormEvent) => void;
  isRunning: boolean;
  onStop: () => void;
}

type MenuMode = 'root' | 'mentions' | 'actions';

/** Prompt C Step 5: submenus pick a concrete commit / wiki section / rule. */
type SubProvider = 'gitCommit' | 'wiki' | 'rule';

interface ContextProviderEntry {
  token: string;
  hint: string;
  icon: LucideIcon;
  submenu?: SubProvider;
}

const CONTEXT_PROVIDERS: ContextProviderEntry[] = [
  { token: 'codeChanges', hint: 'Uncommitted working-tree changes', icon: FileDiff },
  { token: 'gitCommit', hint: 'Pick a commit and attach its diff', icon: GitCommit, submenu: 'gitCommit' },
  { token: 'openFiles', hint: 'Currently open editor tabs', icon: FolderOpen },
  { token: 'wiki', hint: 'Attach a generated wiki section', icon: BookOpen, submenu: 'wiki' },
  { token: 'rule', hint: 'Attach a rule from .tycode/rules', icon: ScrollText, submenu: 'rule' }
];

function capText(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}\n… [truncated ${value.length - limit} chars]` : value;
}

function previewLine(value: string, limit: number): string {
  const first = (value.split('\n')[0] || '').trim();
  return first.length > limit ? `${first.slice(0, limit)}…` : first;
}

function isImageMime(mimeType: string): boolean {
  return typeof mimeType === 'string' && mimeType.startsWith('image/');
}

// Voice dictation: capture mic PCM in the renderer (Chromium native capture),
// convert to 16 kHz mono PCM16, and stream frames to the local whisper sidecar.
function int16ArrayToBase64(int16: Int16Array): string {
  const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
  let binary = '';
  const sliceSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += sliceSize) {
    const slice = Array.from(bytes.subarray(offset, offset + sliceSize));
    binary += String.fromCharCode.apply(null, slice);
  }
  return btoa(binary);
}

function downsampleTo16k(input: Float32Array, inputRate: number): Int16Array {
  const ratio = Math.max(1, inputRate / TARGET_VOICE_SAMPLE_RATE);
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Int16Array(outputLength);
  for (let index = 0; index < outputLength; index++) {
    const position = index * ratio;
    const left = Math.floor(position);
    const fraction = position - left;
    const sample = left + 1 < input.length
      ? input[left] + (input[left + 1] - input[left]) * fraction
      : input[left];
    const clamped = Math.max(-1, Math.min(1, sample));
    output[index] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return output;
}

export function ChatInput({ input, inputRef, onInputChange, onKeyDown, onSubmit, isRunning, onStop }: ChatInputProps) {
  const attachments = useChatInputStore((state) => state.attachments);
  const addAttachment = useChatInputStore((state) => state.addAttachment);
  const removeAttachment = useChatInputStore((state) => state.removeAttachment);
  const flatTree = useWorkspaceStore((state) => state.flatTree);
  const workspacePath = useWorkspaceStore((state) => state.workspacePath);

  const mediaPickerRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);

  const [menuMode, setMenuMode] = useState<MenuMode | null>(null);
  const [mentionQuery, setMentionQuery] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [subMenu, setSubMenu] = useState<SubProvider | null>(null);
  const [subLoading, setSubLoading] = useState(false);
  const [commitItems, setCommitItems] = useState<GitCommitInfo[]>([]);
  const [wikiItems, setWikiItems] = useState<WikiSectionMeta[]>([]);
  const [ruleItems, setRuleItems] = useState<RuleMeta[]>([]);

  type MicState = 'idle' | 'recording' | 'transcribing';
  const [micState, setMicState] = useState<MicState>('idle');
  const micStateRef = useRef<MicState>('idle');
  const micSessionRef = useRef('');
  const micAudioContextRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const micSinkRef = useRef<GainNode | null>(null);
  const micMaxTimerRef = useRef<number | null>(null);

  const workspaceFiles = useMemo<FlatFileNodeEntry[]>(
    () => (flatTree || []).filter((entry) => entry.type === 'file'),
    [flatTree]
  );

  const slashMatches = useMemo(() => {
    if (!input.startsWith('/') || /\s/.test(input)) return SLASH_COMMANDS;
    return SLASH_COMMANDS.filter((command) => command.command.startsWith(input.toLowerCase()));
  }, [input]);

  const mentionMatches = useMemo(() => {
    if (menuMode !== 'mentions') return [];
    const query = mentionQuery.trim().toLowerCase();
    if (!query) return workspaceFiles.slice(0, 8);
    return workspaceFiles
      .filter((entry) =>
        entry.name.toLowerCase().includes(query) ||
        (entry.relativePath || entry.path).toLowerCase().includes(query))
      .slice(0, 8);
  }, [menuMode, mentionQuery, workspaceFiles]);

  // Virtual context providers (@codeChanges/@gitCommit/@openFiles/@wiki/@rule) are
  // surfaced above workspace-file matches; submenus own the picker instead.
  const providerMatches = useMemo(() => {
    if (menuMode !== 'mentions' || subMenu !== null) return [];
    const query = mentionQuery.trim().toLowerCase();
    if (!query) return CONTEXT_PROVIDERS;
    return CONTEXT_PROVIDERS.filter((provider) => provider.token.toLowerCase().includes(query));
  }, [menuMode, mentionQuery, subMenu]);

  const closeMenus = useCallback(() => {
    setMenuMode(null);
    setMentionQuery('');
    setSubMenu(null);
  }, []);

  // '@' typed in the composer opens the mention dropdown; '/' at the start opens actions.
  const handleInputChanged = useCallback((value: string) => {
    onInputChange(value);
    const atIdx = value.lastIndexOf('@');
    if (atIdx !== -1 && !/\s/.test(value.slice(atIdx + 1))) {
      setMenuMode('mentions');
      setMentionQuery(value.slice(atIdx + 1));
      setSubMenu(null);
      return;
    }
    if (value.startsWith('/') && !/\s/.test(value)) {
      setMenuMode('actions');
      setMentionQuery('');
      return;
    }
    if (menuMode === 'mentions' && atIdx === -1 && mentionQuery !== '') closeMenus();
  }, [onInputChange, menuMode, mentionQuery, closeMenus]);

  const attachWorkspacePath = useCallback(async (filePath: string, source: 'mention' | 'file', clearToken?: () => void) => {
    try {
      const response = await window.electronAPI.readFileForContext(filePath);
      if (!response.success || !response.data) {
        toast.error(
          source === 'mention' ? 'Cannot attach file' : 'Cannot read dropped file',
          response.error || 'Only files inside the workspace can be attached.'
        );
        return;
      }
      const ctx = response.data;
      const media = isImageMime(ctx.mimeType);
      addAttachment({
        id: '',
        type: source === 'mention' ? 'mention' : media ? 'media' : 'file',
        name: ctx.name,
        content: ctx.content,
        mimeType: ctx.mimeType
      });
      clearToken?.();
    } catch (err: any) {
      toast.error(source === 'mention' ? 'Cannot attach file' : 'Cannot read dropped file', err?.message || String(err));
    }
  }, [addAttachment]);

  // Workspace files go through chat:read-file-for-context (base64 images, 200-line text);
  // files from outside the workspace fall back to direct File reads.
  const attachNativeFile = useCallback(async (file: File, source: 'file-drop' | 'clipboard' = 'file-drop') => {
    try {
      if (source === 'file-drop') {
        const absolutePath = window.electronAPI.getFilePathForDroppedFile(file);
        if (absolutePath) {
          await attachWorkspacePath(absolutePath, 'file');
          return;
        }
      }
    } catch {
      // Path resolution failed: fall back to direct File reads below.
    }
    if (file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i.test(file.name)) {
      if (file.size > FALLBACK_IMAGE_BYTES) {
        toast.error('Image too large', 'Attach images under 6MB from outside the workspace.');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          addAttachment({ id: '', type: 'media', name: file.name, content: reader.result as string, mimeType: file.type });
        }
      };
      reader.readAsDataURL(file);
      return;
    }
    if (/\.(txt|md|json|ts|tsx|js|jsx|css|html|py|rs|go|java|c|cpp|cs|rb|php|sh|yml|yaml|toml)$/i.test(file.name)) {
      if (file.size > FALLBACK_TEXT_BYTES) {
        toast.error('File too large', 'Attach text files under 512KB from outside the workspace.');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          addAttachment({ id: '', type: 'file', name: file.name, content: reader.result, mimeType: file.type || 'text/plain' });
        }
      };
      reader.readAsText(file);
      return;
    }
    toast.error('Unsupported file type', 'Only images and text files can be attached.');
  }, [attachWorkspacePath, addAttachment]);

  const handleMediaPicked = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    closeMenus();
    void (async () => {
      for (const file of files) {
        if (useChatInputStore.getState().attachments.length >= MAX_ATTACHMENTS) {
          toast.warning('Attachment limit', 'Up to 7 attachments per message.');
          break;
        }
        await attachNativeFile(file);
      }
    })();
  }, [attachNativeFile, closeMenus]);

  const handleMentionSelected = useCallback((entry: FlatFileNodeEntry) => {
    const value = input;
    const atIdx = value.lastIndexOf('@');
    const clearToken = atIdx !== -1 && !/\s/.test(value.slice(atIdx + 1))
      ? () => onInputChange((value.slice(0, atIdx) + value.slice(atIdx + 1 + mentionQuery.length)).trimStart())
      : undefined;
    closeMenus();
    void attachWorkspacePath(entry.path, 'mention', clearToken);
  }, [input, mentionQuery, onInputChange, closeMenus, attachWorkspacePath]);

  // Prompt C Step 5: context providers reuse the existing mention attachment
  // pipeline, so ChatSidecar's "@name\ncontent" composition picks them up
  // without any extra plumbing on the send path.
  const clearMentionToken = useCallback(() => {
    const atIdx = input.lastIndexOf('@');
    if (atIdx !== -1 && !/\s/.test(input.slice(atIdx + 1))) {
      onInputChange((input.slice(0, atIdx) + input.slice(atIdx + 1 + mentionQuery.length)).trimStart());
    }
  }, [input, mentionQuery, onInputChange]);

  const attachContextMention = useCallback((name: string, content: string) => {
    if (useChatInputStore.getState().attachments.length >= MAX_ATTACHMENTS) {
      toast.warning('Attachment limit', 'Up to 7 attachments per message.');
      return;
    }
    addAttachment({ id: '', type: 'mention', name, content });
    clearMentionToken();
    closeMenus();
  }, [addAttachment, clearMentionToken, closeMenus]);

  const attachCodeChanges = useCallback(async () => {
    try {
      const repoPath = workspacePath || undefined;
      const statusRes = await window.electronAPI.gitGetStatus({ repoPath });
      if (!statusRes.success || !statusRes.data) {
        toast.error('Cannot read git status', statusRes.error || 'Is this a git repository?');
        return;
      }
      const status = statusRes.data;
      if (!status.isRepo) {
        toast.error('Not a git repository', '@codeChanges needs a git workspace.');
        return;
      }
      const diffRes = await window.electronAPI.gitGetDiff({ repoPath });
      const diff = diffRes.success ? (diffRes.data || '') : '';
      const summary = [
        `Branch ${status.currentBranch || 'unknown'} (${status.isClean ? 'clean' : 'has changes'})`,
        `Staged: ${status.stagedFiles.map((f) => f.path).join(', ') || 'none'}`,
        `Unstaged: ${status.unstagedFiles.map((f) => f.path).join(', ') || 'none'}`,
        `Untracked: ${status.untrackedFiles.map((f) => f.path).join(', ') || 'none'}`
      ].join('\n');
      const body = diff.trim() ? `UNSTAGED DIFF (working tree):\n${capText(diff, 16000)}` : '(no unstaged diff content)';
      attachContextMention('codeChanges', `UNCOMMITTED CHANGES\n${summary}\n\n${body}`);
    } catch (err: any) {
      toast.error('Cannot read code changes', err?.message || String(err));
    }
  }, [workspacePath, attachContextMention]);

  const attachOpenFiles = useCallback(() => {
    const tabs = useWorkspaceStore.getState().openTabs;
    if (tabs.length === 0) {
      toast.warning('No open files', 'Open editor tabs will be attached as context.');
      return;
    }
    const body = tabs
      .map((tab) => `--- ${tab.name} (${tab.path})${tab.isDirty ? ' • unsaved' : ''} ---\n${capText(tab.content, 8000)}`)
      .join('\n\n');
    attachContextMention('openFiles', `OPEN EDITOR TABS (${tabs.length})\n${capText(body, 40000)}`);
  }, [attachContextMention]);

  const openSubmenu = useCallback(async (submenu: SubProvider) => {
    setSubMenu(submenu);
    setSubLoading(true);
    try {
      if (submenu === 'gitCommit') {
        const res = await window.electronAPI.gitGetLog({ maxCount: 30, repoPath: workspacePath || undefined });
        if (!res.success) {
          toast.error('Cannot read commit history', res.error || 'Is this a git repository?');
          setSubMenu(null);
          return;
        }
        setCommitItems(res.data || []);
      } else if (submenu === 'wiki') {
        if (!workspacePath) {
          toast.error('No workspace open', '@wiki needs an open workspace.');
          setSubMenu(null);
          return;
        }
        const res = await window.electronAPI.wiki?.status(workspacePath);
        if (!res?.success) {
          toast.error('Cannot read wiki status', res?.error || 'Wiki service unavailable.');
          setSubMenu(null);
          return;
        }
        setWikiItems(res.data && res.data.exists ? res.data.sections : []);
      } else {
        if (!workspacePath) {
          toast.error('No workspace open', '@rule needs an open workspace.');
          setSubMenu(null);
          return;
        }
        const res = await window.electronAPI.rules?.list(workspacePath);
        if (!res?.success) {
          toast.error('Cannot read rules', res?.error || 'Rules service unavailable.');
          setSubMenu(null);
          return;
        }
        setRuleItems(res.data || []);
      }
    } catch (err: any) {
      toast.error('Cannot load context', err?.message || String(err));
      setSubMenu(null);
    } finally {
      setSubLoading(false);
    }
  }, [workspacePath]);

  const attachGitCommit = useCallback(async (commit: GitCommitInfo) => {
    try {
      const res = await window.electronAPI.gitGetCommitDetail({ hash: commit.hash, repoPath: workspacePath || undefined });
      if (!res.success || !res.data) {
        toast.error('Cannot read commit', res.error || String(res.data));
        return;
      }
      const detail = res.data;
      const files = detail.files.map((f) => `${f.status} ${f.path}`).join('\n') || '(no files listed)';
      const text = [
        `COMMIT ${detail.commit.shortHash} — ${detail.commit.message}`,
        `Author: ${detail.commit.authorName} <${detail.commit.authorEmail}>  Date: ${detail.commit.date}`,
        '',
        'FILES',
        files,
        '',
        'DIFF',
        capText(detail.diff || '', 20000)
      ].join('\n');
      attachContextMention(`gitCommit:${detail.commit.shortHash}`, text);
    } catch (err: any) {
      toast.error('Cannot read commit', err?.message || String(err));
    }
  }, [workspacePath, attachContextMention]);

  const attachWikiSection = useCallback(async (section: WikiSectionId) => {
    if (!workspacePath) return;
    try {
      const res = await window.electronAPI.wiki?.read(workspacePath, section);
      if (!res?.success) {
        toast.error('Cannot read wiki section', res?.error || 'Wiki service unavailable.');
        return;
      }
      const content = res.data?.content;
      if (!content) {
        toast.warning('Section not generated', 'Regenerate the wiki from the Wiki tab first.');
        return;
      }
      attachContextMention(`wiki:${section}`, capText(content, 30000));
    } catch (err: any) {
      toast.error('Cannot read wiki section', err?.message || String(err));
    }
  }, [workspacePath, attachContextMention]);

  const attachRule = useCallback(async (ruleName: string) => {
    if (!workspacePath) return;
    try {
      const res = await window.electronAPI.rules?.read(workspacePath, ruleName);
      if (!res?.success) {
        toast.error('Cannot read rule', res?.error || 'Rules service unavailable.');
        return;
      }
      const rule = res.data;
      if (!rule) {
        toast.warning('Rule not found', `'${ruleName}' no longer exists in .tycode/rules.`);
        return;
      }
      attachContextMention(`rule:${ruleName}`, `RULE ${rule.title} (mode: ${rule.mode})\n\n${capText(rule.body, 20000)}`);
    } catch (err: any) {
      toast.error('Cannot read rule', err?.message || String(err));
    }
  }, [workspacePath, attachContextMention]);

  const handleProviderSelected = useCallback((provider: ContextProviderEntry) => {
    if (provider.submenu) {
      void openSubmenu(provider.submenu);
      return;
    }
    if (provider.token === 'codeChanges') {
      void attachCodeChanges();
      return;
    }
    if (provider.token === 'openFiles') {
      attachOpenFiles();
    }
  }, [openSubmenu, attachCodeChanges, attachOpenFiles]);

  const handleSlashSelected = useCallback((template: string) => {
    onInputChange(template);
    closeMenus();
    window.setTimeout(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.selectionStart = template.length;
        el.selectionEnd = template.length;
      }
    }, 0);
  }, [onInputChange, closeMenus, inputRef]);

  // Drag-and-drop zone: accepts Explorer drags (custom MIME) and native OS files.
  const handleDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepthRef.current += 1;
    setDragActive(true);
  };
  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDragActive(true);
  };
  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  };
  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepthRef.current = 0;
    setDragActive(false);
    const droppedPath = event.dataTransfer.getData(TY_CODE_FILE_MIME);
    if (droppedPath) {
      void attachWorkspacePath(droppedPath, 'file');
      return;
    }
    const files = Array.from(event.dataTransfer.files || []);
    if (files.length > 0) {
      void (async () => {
        for (const file of files) {
          if (useChatInputStore.getState().attachments.length >= MAX_ATTACHMENTS) {
            toast.warning('Attachment limit', 'Up to 7 attachments per message.');
            break;
          }
          await attachNativeFile(file);
        }
      })();
    }
  };

  const handleComposerKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      if (subMenu !== null) {
        setSubMenu(null);
        return;
      }
      if (menuMode !== null) {
        closeMenus();
        return;
      }
    }
    onKeyDown(event);
  }, [menuMode, subMenu, closeMenus, onKeyDown]);

  const teardownVoiceCapture = useCallback(() => {
    if (micMaxTimerRef.current !== null) {
      window.clearTimeout(micMaxTimerRef.current);
      micMaxTimerRef.current = null;
    }
    try {
      if (micProcessorRef.current) {
        micProcessorRef.current.disconnect();
        micProcessorRef.current.onaudioprocess = null;
        micProcessorRef.current = null;
      }
      if (micSourceRef.current) {
        micSourceRef.current.disconnect();
        micSourceRef.current = null;
      }
      if (micSinkRef.current) {
        micSinkRef.current.disconnect();
        micSinkRef.current = null;
      }
      if (micAudioContextRef.current) {
        void micAudioContextRef.current.close();
        micAudioContextRef.current = null;
      }
      if (micStreamRef.current) {
        for (const track of micStreamRef.current.getTracks()) track.stop();
        micStreamRef.current = null;
      }
    } catch {
      // Capture teardown is best-effort
    }
  }, []);

  const stopVoiceTranscription = useCallback(async () => {
    if (micStateRef.current !== 'recording') return;
    const sessionId = micSessionRef.current;
    micStateRef.current = 'transcribing';
    setMicState('transcribing');
    micSessionRef.current = '';
    teardownVoiceCapture();
    try {
      const response = await window.electronAPI.stopVoiceRecording(sessionId);
      if (response.success && response.data) {
        const text = (response.data.text || '').trim();
        if (text) {
          onInputChange(input.trim() ? `${input.trim()} ${text}` : text);
        } else {
          toast.info('Nothing detected', 'No speech was captured in the recording.');
        }
      } else {
        toast.error('Voice transcription failed', response.error || 'Transcription failed');
      }
    } catch (err: any) {
      toast.error('Voice transcription failed', err?.message || 'Transcription failed');
    } finally {
      micStateRef.current = 'idle';
      setMicState('idle');
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.selectionStart = el.value.length;
        el.selectionEnd = el.value.length;
      }
    }
  }, [input, onInputChange, inputRef, teardownVoiceCapture]);

  const startVoiceCapture = useCallback(async () => {
    try {
      const ready = await window.electronAPI.ensureVoiceReady();
      if (!ready.success) {
        toast.error('Voice transcription unavailable', ready.error || 'The voice engine failed to initialize.');
        return;
      }
      const session = await window.electronAPI.startVoiceRecording();
      if (!session.success || !session.data) {
        toast.error('Voice recording failed', session.error || 'Could not start the voice session.');
        return;
      }
      const sessionId = session.data.sessionId;
      micSessionRef.current = sessionId;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      micStreamRef.current = stream;
      const context = new AudioContext();
      micAudioContextRef.current = context;
      const source = context.createMediaStreamSource(stream);
      micSourceRef.current = source;
      const processor = context.createScriptProcessor(4096, 1, 1);
      micProcessorRef.current = processor;
      const sink = context.createGain();
      sink.gain.value = 0;
      micSinkRef.current = sink;
      const inputRate = context.sampleRate;
      processor.onaudioprocess = (event) => {
        if (!micSessionRef.current) return;
        const chunkInput = event.inputBuffer.getChannelData(0);
        const pcm = downsampleTo16k(chunkInput, inputRate);
        void window.electronAPI.appendVoiceChunk(sessionId, int16ArrayToBase64(pcm));
      };
      source.connect(processor);
      processor.connect(sink);
      sink.connect(context.destination);
      micMaxTimerRef.current = window.setTimeout(() => {
        void stopVoiceTranscription();
      }, VOICE_MAX_RECORDING_MS);
    } catch (err: any) {
      micSessionRef.current = '';
      teardownVoiceCapture();
      toast.error('Microphone unavailable', err?.message || 'Microphone permission was denied.');
      micStateRef.current = 'idle';
      setMicState('idle');
    }
  }, [stopVoiceTranscription, teardownVoiceCapture]);

  const handleMicToggle = useCallback(() => {
    if (micStateRef.current === 'transcribing') return;
    if (micStateRef.current === 'recording') {
      void stopVoiceTranscription();
      return;
    }
    micStateRef.current = 'recording';
    setMicState('recording');
    void startVoiceCapture();
  }, [stopVoiceTranscription, startVoiceCapture]);

  useEffect(() => () => {
    // Keep the loaded whisper model resident: only discard an in-flight
    // recording session. Full engine release is reserved for app shutdown.
    const sessionId = micSessionRef.current;
    micSessionRef.current = '';
    if (sessionId) {
      try {
        void window.electronAPI?.discardVoiceSession?.(sessionId);
      } catch {
        // Session discard is best-effort on unmount
      }
    }
    teardownVoiceCapture();
  }, [teardownVoiceCapture]);

  const mediaAttachments = attachments.filter((attachment) => attachment.type === 'media');
  const textAttachments = attachments.filter((attachment) => attachment.type !== 'media');
  const canSend = !isRunning && (input.trim().length > 0 || mediaAttachments.length > 0 || textAttachments.length > 0);

  useEffect(() => {
    const onDocumentPointerDown = (event: MouseEvent): void => {
      const target = event.target;
      const composer = inputRef.current?.closest('.chat-composer');
      if (composer && target instanceof Node && composer.contains(target)) return;
      closeMenus();
    };
    document.addEventListener('pointerdown', onDocumentPointerDown);
    return () => document.removeEventListener('pointerdown', onDocumentPointerDown);
  }, [closeMenus, inputRef]);

  return (
    <form onSubmit={onSubmit} className="chat-composer">
      <div
        className="chat-drop-zone"
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {(mediaAttachments.length > 0 || textAttachments.length > 0) && (
          <div className="chat-attachments">
            {mediaAttachments.map((attachment: Attachment) => (
              <div key={attachment.id} className="chat-attachment-thumb" title={attachment.name}>
                <img src={attachment.content} alt={attachment.name} />
                <button type="button" className="chat-attachment-remove" onClick={() => removeAttachment(attachment.id)} aria-label={`Remove ${attachment.name}`}>
                  <X size={10} />
                </button>
              </div>
            ))}
            {textAttachments.map((attachment: Attachment) => (
              <span key={attachment.id} className="chat-attachment-pill" title={attachment.name}>
                <FileText size={12} aria-hidden="true" />
                <span className="chat-attachment-pill-name">{attachment.type === 'mention' ? '@' : ''}{attachment.name}</span>
                <button
                  type="button"
                  className="chat-attachment-remove"
                  onClick={() => removeAttachment(attachment.id)}
                  aria-label={`Remove ${attachment.name}`}
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="chat-composer-field">
          <div className="chat-context-anchor">
            <button
              type="button"
              className="chat-add-context-button"
              aria-expanded={menuMode !== null}
              aria-label="Add context"
              title="Add context: media, file mentions, or slash actions"
              onClick={() => setMenuMode((mode) => (mode ? null : 'root'))}
            >
              <Plus size={14} />
            </button>
            {menuMode !== null && (
              <div className="chat-context-popover" role="menu" aria-label="Add context menu">
                {menuMode === 'root' && (
                  <>
                    <div className="chat-context-menu-title">Add Context</div>
                    <button type="button" className="chat-context-menu-item" onClick={() => { mediaPickerRef.current?.click(); closeMenus(); }}>
                      <ImageIcon size={12} aria-hidden="true" />
                      <span>Media (images)</span>
                    </button>
                    <button type="button" className="chat-context-menu-item" onClick={() => setMenuMode('mentions')}>
                      <AtSign size={12} aria-hidden="true" />
                      <span>Mentions</span>
                      <small>files &amp; context</small>
                    </button>
                    <button type="button" className="chat-context-menu-item" onClick={() => setMenuMode('actions')}>
                      <Slash size={12} aria-hidden="true" />
                      <span>Actions</span>
                      <small>slash commands</small>
                    </button>
                  </>
                )}
                {menuMode === 'mentions' && subMenu === null && (
                  <>
                    <div className="chat-context-menu-title">Mention context or a workspace file</div>
                    {providerMatches.map((provider) => {
                      const ProviderIcon = provider.icon;
                      return (
                        <button
                          type="button"
                          key={provider.token}
                          className="chat-context-menu-item"
                          role="menuitem"
                          onClick={() => handleProviderSelected(provider)}
                          title={provider.hint}
                        >
                          <ProviderIcon size={12} aria-hidden="true" />
                          <span className="chat-context-menu-name">@{provider.token}</span>
                          <small>{provider.hint}</small>
                        </button>
                      );
                    })}
                    {mentionMatches.length === 0 ? (
                      providerMatches.length === 0 ? (
                        <div className="chat-context-empty">No matching context or files</div>
                      ) : null
                    ) : (
                      mentionMatches.map((entry) => (
                        <button
                          type="button"
                          key={entry.path}
                          className="chat-context-menu-item"
                          role="menuitem"
                          onClick={() => handleMentionSelected(entry)}
                          title={entry.relativePath || entry.path}
                        >
                          <AtSign size={12} aria-hidden="true" />
                          <span className="chat-context-menu-name">@{entry.name}</span>
                          <small>{entry.relativePath || entry.path}</small>
                        </button>
                      ))
                    )}
                    <button type="button" className="chat-context-menu-item chat-context-back" onClick={() => setMenuMode('root')}>
                      Back
                    </button>
                  </>
                )}
                {menuMode === 'mentions' && subMenu !== null && (
                  <>
                    <div className="chat-context-menu-title">
                      {subMenu === 'gitCommit' ? 'Attach a commit (last 30)' : subMenu === 'wiki' ? 'Attach a wiki section' : 'Attach a project rule'}
                    </div>
                    {subLoading ? (
                      <div className="chat-context-empty">Loading…</div>
                    ) : subMenu === 'gitCommit' ? (
                      commitItems.length === 0 ? (
                        <div className="chat-context-empty">No commits found</div>
                      ) : (
                        commitItems.slice(0, 15).map((commit) => (
                          <button
                            type="button"
                            key={commit.hash}
                            className="chat-context-menu-item"
                            role="menuitem"
                            onClick={() => void attachGitCommit(commit)}
                            title={`${commit.message}\n${commit.authorName} • ${commit.date}`}
                          >
                            <GitCommit size={12} aria-hidden="true" />
                            <span className="chat-context-menu-name">{commit.shortHash} {previewLine(commit.message, 44)}</span>
                            <small>{previewLine(commit.date, 24)}</small>
                          </button>
                        ))
                      )
                    ) : subMenu === 'wiki' ? (
                      wikiItems.length === 0 ? (
                        <div className="chat-context-empty">No wiki generated yet — build it from the Wiki tab</div>
                      ) : (
                        wikiItems.map((section) => (
                          <button
                            type="button"
                            key={section.id}
                            className="chat-context-menu-item"
                            role="menuitem"
                            onClick={() => void attachWikiSection(section.id)}
                            title={section.file}
                          >
                            <BookOpen size={12} aria-hidden="true" />
                            <span className="chat-context-menu-name">@wiki:{section.id}</span>
                            <small>{section.title}</small>
                          </button>
                        ))
                      )
                    ) : (
                      ruleItems.length === 0 ? (
                        <div className="chat-context-empty">No rules in .tycode/rules yet</div>
                      ) : (
                        ruleItems.map((ruleMeta) => (
                          <button
                            type="button"
                            key={ruleMeta.name}
                            className="chat-context-menu-item"
                            role="menuitem"
                            onClick={() => void attachRule(ruleMeta.name)}
                            title={ruleMeta.description || ruleMeta.file}
                          >
                            <ScrollText size={12} aria-hidden="true" />
                            <span className="chat-context-menu-name">@rule:{ruleMeta.name}</span>
                            <small>{ruleMeta.mode} • {previewLine(ruleMeta.description, 48)}</small>
                          </button>
                        ))
                      )
                    )}
                    <button type="button" className="chat-context-menu-item chat-context-back" onClick={() => setSubMenu(null)}>
                      Back
                    </button>
                  </>
                )}
                {menuMode === 'actions' && (
                  <>
                    <div className="chat-context-menu-title">Actions</div>
                    {slashMatches.map((command) => (
                      <button
                        type="button"
                        key={command.command}
                        className="chat-context-menu-item"
                        role="menuitem"
                        onClick={() => handleSlashSelected(command.template)}
                      >
                        <Slash size={12} aria-hidden="true" />
                        <span className="chat-context-menu-name">{command.command}</span>
                        <small>{command.description}</small>
                      </button>
                    ))}
                    <button type="button" className="chat-context-menu-item chat-context-back" onClick={() => setMenuMode('root')}>
                      Back
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(event) => handleInputChanged(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            onPaste={(event) => {
              const items = Array.from(event.clipboardData?.items || []);
              const imageItems = items.filter((item) => item.type.startsWith('image/'));
              if (imageItems.length === 0) return;
              event.preventDefault();
              void (async () => {
                let pastedSoFar = 0;
                for (const item of imageItems) {
                  const spaceLeft = MAX_ATTACHMENTS - useChatInputStore.getState().attachments.length;
                  if (spaceLeft <= 0) {
                    toast.warning('Attachment limit', 'Up to 7 attachments per message.');
                    return;
                  }
                  const file = item.getAsFile();
                  if (!file) continue;
                  pastedSoFar += 1;
                  const pasteName = imageItems.length > 1 ? `pasted-image-${pastedSoFar}.${file.type.split('/')[1] || 'png'}` : file.name;
                  await attachNativeFile(new File([file], pasteName, { type: file.type }), 'clipboard');
                }
                if (pastedSoFar === 0) {
                  toast.error('Cannot read pasted image', 'The clipboard image could not be attached.');
                }
              })();
            }}
            placeholder="Ask Ty-Code… (Enter to send)"
            aria-label="Message Ty-Code"
            rows={3}
          />
          {(micState === 'recording' || micState === 'transcribing') && (
            <span className="chat-mic-status" role="status">
              {micState === 'recording' ? 'Recording… click to stop' : 'Transcribing locally…'}
            </span>
          )}
          <button
            type="button"
            className={`chat-mic-button${micState === 'recording' ? ' chat-mic-recording' : ''}${micState === 'transcribing' ? ' chat-mic-transcribing' : ''}`}
            onClick={handleMicToggle}
            disabled={micState === 'transcribing'}
            title={micState === 'recording' ? 'Stop and transcribe locally' : 'Dictate voice input (transcribed locally)'}
            aria-label={micState === 'recording' ? 'Stop voice recording' : 'Start voice dictation'}
          >
            <Mic size={13} />
          </button>
          {isRunning ? (
            <button type="button" onClick={onStop} className="chat-send-button is-stop" title="Stop agent" aria-label="Stop agent"><Square size={12} /></button>
          ) : (
            <button type="submit" disabled={!canSend} className="chat-send-button" title="Send message" aria-label="Send message"><Send size={13} /></button>
          )}
        </div>
        <div className="chat-composer-hint">Shift+Enter new line · ↑/↓ history · @ files · / commands · drop files</div>
        {dragActive && (
          <div className="chat-drop-overlay" aria-hidden="true">
            <strong>Drop files here</strong>
            <span>Images attach for vision, text files attach their first 200 lines</span>
          </div>
        )}
      </div>
      <input ref={mediaPickerRef} type="file" accept="image/*" multiple hidden onChange={handleMediaPicked} aria-hidden="true" tabIndex={-1} />
    </form>
  );
}

export default ChatInput;
