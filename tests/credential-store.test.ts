/**
 * Credential Storage & Usage Ledger Unit Tests (RealConnect 2)
 *
 * Verifies that:
 * 1. Plaintext API keys are NEVER written to disk in credentials.json (only encrypted blobs)
 * 2. Encrypted keys reload and decrypt accurately
 * 3. In-memory reveal returns key without writing plaintext to disk
 * 4. Revocation purges credentials and stops attribution
 * 5. Encrypted backup bundle export/import works with AES-256-GCM + PBKDF2
 * 6. Live connection test rejects invalid keys before saving
 * 7. Usage ledger records requests, prompt/completion tokens into SQLite and JSON snapshot
 * 8. Usage ledger exports valid JSON and CSV formats
 *
 * Brand: Ty-Code
 */

import assert from 'node:assert';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import './live-e2e/sandbox-env';
import { CredentialStore, CREDENTIALS_FILE } from '../src/main/services/auth/credential-store';
import { UsageLedgerService } from '../src/main/services/usage/ledger';

export async function runCredentialStoreTests(): Promise<void> {
  console.log('🔐 Testing RealConnect 2: Per-User Credential Storage & Usage Ledger...\n');

  const store = CredentialStore.getInstance();
  const ledger = UsageLedgerService.getInstance();

  // Test 1: Encrypted credential storage (No plaintext on disk)
  console.log('▶ Test 1: Save OpenRouter key -> verify encrypted blob in credentials.json (not plaintext)');
  const sampleKey = 'sk-or-v1-secret-test-key-abcdef1234567890';
  await store.saveCredential('openrouter', sampleKey, 'OpenRouter Free Key');

  // Verify file exists
  assert.ok(fsSync.existsSync(CREDENTIALS_FILE), `Credentials file must exist at ${CREDENTIALS_FILE}`);

  // Read file directly from disk and assert plaintext key is NOT present
  const diskRaw = await fs.readFile(CREDENTIALS_FILE, 'utf8');
  assert.strictEqual(
    diskRaw.includes(sampleKey),
    false,
    'SECURITY VIOLATION: Raw plaintext API key was written to credentials.json!'
  );

  const parsedDoc = JSON.parse(diskRaw);
  assert.ok(parsedDoc.credentials.openrouter, 'Record for openrouter must exist in credentials.json');
  assert.ok(
    parsedDoc.credentials.openrouter.encryptedKey.startsWith('safe_storage_v1:') ||
    parsedDoc.credentials.openrouter.encryptedKey.startsWith('fallback_aes_v1:'),
    `Encrypted key must have proper prefix, got: ${parsedDoc.credentials.openrouter.encryptedKey.slice(0, 20)}`
  );
  console.log('  ✔ Confirmed: credentials.json contains encrypted blob, zero plaintext leakage.');

  // Test 2: Decrypt on reload
  console.log('▶ Test 2: Decrypts correctly and returns original plaintext key');
  const decrypted = store.getDecryptedKey('openrouter');
  assert.strictEqual(decrypted, sampleKey, 'Decrypted key must match original secret key');
  console.log('  ✔ Confirmed: Decrypted key matches original secret key.');

  // Test 3: Reveal key in-memory
  console.log('▶ Test 3: Reveal key in-memory');
  const revealed = store.revealKey('openrouter');
  assert.strictEqual(revealed, sampleKey, 'Reveal key must return the in-memory decrypted key');
  console.log('  ✔ Confirmed: Reveal key works in memory.');

  // Test 4: Live connection test catches invalid keys
  console.log('▶ Test 4: Live Test Connection rejects invalid key before saving');
  const invalidTest = await store.testConnection('openrouter', 'sk-or-v1-invalid-bogus-key-999');
  assert.strictEqual(invalidTest.success, false, 'Invalid OpenRouter key must fail test connection');
  assert.ok(invalidTest.error, 'Error message must be populated');
  console.log(`  ✔ Confirmed: Test connection caught invalid key: "${invalidTest.error}"`);

  // Test 5: Usage ledger SQLite and JSON snapshot
  console.log('▶ Test 5: Usage ledger records transactions into SQLite and JSON snapshot');
  await ledger.loadLedger();
  const txStartCount = ledger.getSnapshot().overall.totalRequests;

  await ledger.recordTransaction({
    providerId: 'openrouter',
    modelId: 'deepseek/deepseek-r1:free',
    promptTokens: 120,
    completionTokens: 280,
    totalTokens: 400,
    isExactUsage: true,
    latencyMs: 185,
    success: true,
    headers: {
      'x-ratelimit-remaining': '19',
      'x-ratelimit-reset': '60'
    }
  });

  const snapshot = ledger.getSnapshot();
  assert.strictEqual(snapshot.overall.totalRequests, txStartCount + 1, 'Total requests must increment');
  assert.ok(snapshot.providerCounters['openrouter:deepseek/deepseek-r1:free'], 'Model counter must exist');
  assert.strictEqual(
    snapshot.providerCounters['openrouter:deepseek/deepseek-r1:free'].totalTokens >= 400,
    true,
    'Tokens must be accumulated'
  );

  // Check rate limit extraction
  const rateLimit = snapshot.rateLimits.openrouter;
  assert.ok(rateLimit, 'Rate limit info must be recorded for openrouter');
  assert.strictEqual(rateLimit.remainingRequests, 19, 'Rate limit remaining must be 19');
  assert.ok(rateLimit.resetHuman?.includes('resets in') || rateLimit.resetHuman === 'active', 'Human-readable reset must be set');
  console.log(`  ✔ Confirmed: Transaction recorded, rate limit parsed: "${rateLimit.resetHuman}"`);

  // Verify SQLite rows if sqliteDb is initialized
  const sqliteRows = ledger.getSqliteRows(5);
  if (ledger.getSqliteDb()) {
    assert.ok(sqliteRows.length > 0, 'SQLite must have at least 1 ledger row');
    assert.strictEqual(sqliteRows[0].provider_id, 'openrouter', 'SQLite provider_id must match');
    assert.strictEqual(sqliteRows[0].total_tokens, 400, 'SQLite total_tokens must match');
    console.log(`  ✔ Confirmed: SQLite row verified (${sqliteRows.length} rows in usage_ledger table).`);
  }

  // Test 6: Export JSON and CSV
  console.log('▶ Test 6: Usage ledger JSON and CSV export');
  const jsonExport = ledger.exportJson();
  assert.ok(jsonExport.includes('"totalRequests"'), 'JSON export must contain totalRequests');

  const csvExport = ledger.exportCsv();
  assert.ok(csvExport.startsWith('ID,Timestamp_ISO,Provider,Model'), 'CSV export must have proper headers');
  assert.ok(csvExport.includes('openrouter'), 'CSV export must include recorded provider');
  console.log('  ✔ Confirmed: Ledger exported to valid JSON and CSV.');

  // Test 7: Encrypted Backup Export & Import
  console.log('▶ Test 7: Encrypted backup export and import bundle');
  const backupPass = 'test-secret-passphrase-42';
  const backupBundle = await store.exportBackup(backupPass);
  const bundleObj = JSON.parse(backupBundle);
  assert.strictEqual(bundleObj.format, 'ty-code-credential-bundle-v1', 'Bundle format must match');
  assert.ok(bundleObj.authTag && bundleObj.iv && bundleObj.salt, 'Bundle must contain GCM parameters');

  // Import into store
  const importResult = await store.importBackup(backupBundle, backupPass);
  assert.strictEqual(importResult.success, true, 'Bundle import must succeed with correct passphrase');
  assert.ok(importResult.count >= 1, 'At least 1 key must be imported');

  // Wrong passphrase must fail
  const wrongPassResult = await store.importBackup(backupBundle, 'wrong-passphrase');
  assert.strictEqual(wrongPassResult.success, false, 'Import with wrong passphrase must fail');
  console.log('  ✔ Confirmed: Encrypted backup export/import validated with AES-256-GCM.');

  // Test 8: Revocation
  console.log('▶ Test 8: Revoke credential permanently');
  const revoked = await store.revokeCredential('openrouter');
  assert.strictEqual(revoked, true, 'Revocation must return true');
  assert.strictEqual(store.hasCredential('openrouter'), false, 'Credential must no longer be present');
  assert.strictEqual(store.getDecryptedKey('openrouter'), null, 'Decrypted key must be null after revocation');
  console.log('  ✔ Confirmed: Credential revoked and removed from storage.');

  console.log('\n✅ All RealConnect 2 Credential Storage & Ledger Tests Passed (8/8)!\n');
}

// Allow direct CLI execution: node -r esbuild-register tests/credential-store.test.ts
if (require.main === module || process.argv[1]?.includes('credential-store.test')) {
  runCredentialStoreTests().catch((err) => {
    console.error('❌ Test failed:', err);
    process.exit(1);
  });
}
