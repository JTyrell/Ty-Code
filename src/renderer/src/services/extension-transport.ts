import { parseExtensionRpcMessage, type ExtensionRpcMessage } from '../../../preload/extension-schemas';

export interface ExtensionTransport {
  postMessage(message: ExtensionRpcMessage): void;
  subscribe(listener: (message: unknown) => void, onFailure: (error: Error) => void): () => void;
  terminate(): void;
}

export class WorkerTransport implements ExtensionTransport {
  private readonly worker: Worker;

  constructor() {
    this.worker = new Worker(new URL('../workers/extension-worker.ts', import.meta.url), { type: 'module' });
  }

  postMessage(message: ExtensionRpcMessage): void { this.worker.postMessage(message); }

  subscribe(listener: (message: unknown) => void, onFailure: (error: Error) => void): () => void {
    const onMessage = (event: MessageEvent<unknown>) => listener(event.data);
    const onError = (event: ErrorEvent) => onFailure(new Error(event.message || 'Extension Worker failed.'));
    const onMessageError = () => onFailure(new Error('Extension Worker sent an uncloneable message.'));
    this.worker.addEventListener('message', onMessage);
    this.worker.addEventListener('error', onError);
    this.worker.addEventListener('messageerror', onMessageError);
    return () => {
      this.worker.removeEventListener('message', onMessage);
      this.worker.removeEventListener('error', onError);
      this.worker.removeEventListener('messageerror', onMessageError);
    };
  }

  terminate(): void { this.worker.terminate(); }
}

export function validateTransportMessage(input: unknown): ExtensionRpcMessage {
  return parseExtensionRpcMessage(input);
}
