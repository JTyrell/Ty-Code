import { stdin, stdout } from 'node:process';

let buffer = Buffer.alloc(0);

function send(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  stdout.write(body);
}

stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd < 0) break;
    const header = buffer.subarray(0, headerEnd).toString('ascii');
    const length = Number(header.match(/Content-Length:\s*(\d+)/i)?.[1]);
    if (!Number.isFinite(length)) process.exit(2);
    const bodyStart = headerEnd + 4;
    if (buffer.length < bodyStart + length) break;
    const message = JSON.parse(buffer.subarray(bodyStart, bodyStart + length).toString('utf8'));
    buffer = buffer.subarray(bodyStart + length);

    if (message.method === 'initialize') {
      send({ jsonrpc: '2.0', id: message.id, result: { capabilities: { completionProvider: { triggerCharacters: ['.'] } } } });
      continue;
    }
    if (message.method === 'shutdown') {
      send({ jsonrpc: '2.0', id: message.id, result: null });
      continue;
    }
    if (message.method === 'textDocument/completion') {
      send({ jsonrpc: '2.0', id: message.id, result: { items: [{ label: 'fakeCompletion' }] } });
      continue;
    }
    if (message.method === 'textDocument/didOpen') {
      const document = message.params?.textDocument;
      send({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri: document.uri, diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, severity: 1, message: 'fixture diagnostic' }] } });
    }
  }
});
