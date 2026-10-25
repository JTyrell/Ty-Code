import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AtSign, FileText, Image as ImageIcon, Mic, Plus, Send, Slash, Square, X } from 'lucide-react';
import type { FlatFileNodeEntry } from '../../../../preload/types';
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

  const mediaPickerRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);

  const [menuMode, setMenuMode] = useState<MenuMode | null>(null);
  const [mentionQuery, setMentionQuery] = useState('');
  const [dragActive, setDragActive] = useState(false);

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

  const closeMenus = useCallback(() => {
    setMenuMode(null);
    setMentionQuery('');
  }, []);

  // '@' typed in the composer opens the mention dropdown; '/' at the start opens actions.
  const handleInputChanged = useCallback((value: string) => {
    onInputChange(value);
    const atIdx = value.lastIndexOf('@');
    if (atIdx !== -1 && !/\s/.test(value.slice(atIdx + 1))) {
      setMenuMode('mentions');
      setMentionQuery(value.slice(atIdx + 1));
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
  const attachNativeFile = useCallback(async (file: File) => {
    try {
      const absolutePath = window.electronAPI.getFilePathForDroppedFile(file);
      await attachWorkspacePath(absolutePath, 'file');
      return;
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
          toast.warning('Attachment limit', 'Up to 4 attachments per message.');
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
            toast.warning('Attachment limit', 'Up to 4 attachments per message.');
            break;
          }
          await attachNativeFile(file);
        }
      })();
    }
  };

  const handleComposerKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape' && menuMode !== null) {
      closeMenus();
      return;
    }
    onKeyDown(event);
  }, [menuMode, closeMenus, onKeyDown]);

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
                      <small>workspace files</small>
                    </button>
                    <button type="button" className="chat-context-menu-item" onClick={() => setMenuMode('actions')}>
                      <Slash size={12} aria-hidden="true" />
                      <span>Actions</span>
                      <small>slash commands</small>
                    </button>
                  </>
                )}
                {menuMode === 'mentions' && (
                  <>
                    <div className="chat-context-menu-title">Mention a workspace file</div>
                    {mentionMatches.length === 0 ? (
                      <div className="chat-context-empty">No matching files</div>
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
              const spaceLeft = MAX_ATTACHMENTS - useChatInputStore.getState().attachments.length;
              if (spaceLeft <= 0) {
                toast.warning('Attachment limit', 'Up to 4 attachments per message.');
                return;
              }
              for (const item of imageItems.slice(0, spaceLeft)) {
                const file = item.getAsFile();
                if (!file) continue;
                if (file.size > FALLBACK_IMAGE_BYTES) continue;
                void attachNativeFile(file);
              }
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
