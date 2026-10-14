import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function toFileUri(filePathOrUri: string): string {
  if (filePathOrUri.startsWith('file:')) {
    const parsed = new URL(filePathOrUri);
    if (parsed.protocol !== 'file:') throw new Error('Only file: URIs are supported for workspace documents.');
    return pathToFileURL(fileURLToPath(parsed)).href;
  }
  return pathToFileURL(path.resolve(filePathOrUri)).href;
}

export function fromFileUri(filePathOrUri: string): string {
  if (!filePathOrUri.startsWith('file:')) return path.resolve(filePathOrUri);
  const parsed = new URL(filePathOrUri);
  if (parsed.protocol !== 'file:') throw new Error('Only file: URIs are supported for workspace documents.');
  return fileURLToPath(parsed);
}
