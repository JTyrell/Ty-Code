import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { PolicyEngine } from '../src/main/services/policy/policy-engine';
import { getMostRestrictivePolicy, getDefaultPolicy, type EnterprisePolicy } from '../src/main/services/policy/policy-schema';

describe('Feature 2: Enterprise-Policy Override Engine', () => {
  let tmpWorkspace: string;

  beforeEach(async () => {
    tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'tycode-policy-test-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpWorkspace, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  describe('Default Policy Resolution', () => {
    it('initializes with default permissive policy when no enterprise file exists', async () => {
      const engine = new PolicyEngine(tmpWorkspace);
      await engine.initialize();

      expect(engine.getPolicySource()).toBe('default');
      const policy = engine.getEffectivePolicy();
      expect(policy.org).toBe('Ty-Code Community Defaults');
      expect(policy.locked.modes.locked).toBe(false);

      expect(engine.isModeAllowed('BUILD')).toBe(true);
      expect(engine.isModeAllowed('REVIEW')).toBe(true);
      expect(engine.isRoleAllowed('security')).toBe(true);
      expect(engine.isProviderAllowed('anthropic')).toBe(true);
      expect(engine.isFreeRoutingAllowed()).toBe(true);
    });
  });

  describe('Org Policy (.tycode/enterprise-policy.json) Enforcement', () => {
    it('loads and enforces locked enterprise policy restrictions', async () => {
      const dotTycode = path.join(tmpWorkspace, '.tycode');
      await fs.mkdir(dotTycode, { recursive: true });

      const enterprisePolicy: EnterprisePolicy = {
        $schema: 'https://tycode.dev/schemas/enterprise-policy.v1.json',
        version: 1,
        org: 'Acme Financial SecOps',
        locked: {
          terminalPolicy: 'disabled',
          modes: {
            locked: true,
            allowed: ['REVIEW', 'DESIGN'],
            default: 'REVIEW'
          },
          roles: {
            locked: true,
            allowed: ['security', 'review'],
            denied: ['destructive', 'unauthorized']
          },
          providers: {
            allowlist: ['anthropic'],
            denylist: ['openrouter', 'unapproved-provider'],
            requireLocalOnly: false
          },
          routing: {
            freeModeEnabled: false,
            fallbackEnabled: true,
            requireEncryptionInTransit: true
          },
          security: {
            workspaceContainment: 'strict',
            safeEditReviewGate: true,
            systemAccess: false
          },
          features: {
            m3eCanvas: false,
            ledgerExport: true
          },
          ledger: {
            retentionDays: 365,
            hashChainRequired: true
          }
        }
      };

      await fs.writeFile(
        path.join(dotTycode, 'enterprise-policy.json'),
        JSON.stringify(enterprisePolicy, null, 2),
        'utf8'
      );

      const engine = new PolicyEngine(tmpWorkspace);
      await engine.initialize();

      expect(engine.getPolicySource()).toBe('org-file');
      expect(engine.getEffectivePolicy().org).toBe('Acme Financial SecOps');

      // Mode assertions
      const reviewMode = engine.assertAllowed({ type: 'mode_selection', target: 'REVIEW' });
      expect(reviewMode.allowed).toBe(true);

      const buildMode = engine.assertAllowed({ type: 'mode_selection', target: 'BUILD' });
      expect(buildMode.allowed).toBe(false);
      expect(buildMode.reason).toContain("Mode 'BUILD' is not permitted by enterprise policy");

      // Role assertions
      const securityRole = engine.assertAllowed({ type: 'role_selection', target: 'security' });
      expect(securityRole.allowed).toBe(true);

      const deniedRole = engine.assertAllowed({ type: 'role_selection', target: 'destructive' });
      expect(deniedRole.allowed).toBe(false);
      expect(deniedRole.reason).toContain("Role 'destructive' is explicitly denied");

      const unlistedRole = engine.assertAllowed({ type: 'role_selection', target: 'blockchain' });
      expect(unlistedRole.allowed).toBe(false);
      expect(unlistedRole.reason).toContain("Role 'blockchain' is not in permitted enterprise roles");

      // Provider assertions
      const anthropicProvider = engine.assertAllowed({ type: 'provider_dispatch', target: 'anthropic' });
      expect(anthropicProvider.allowed).toBe(true);

      const blockedProvider = engine.assertAllowed({ type: 'provider_dispatch', target: 'openrouter' });
      expect(blockedProvider.allowed).toBe(false);

      const freeRouting = engine.assertAllowed({ type: 'free_routing', target: 'auto' });
      expect(freeRouting.allowed).toBe(false);
      expect(freeRouting.reason).toContain('Free-tier routing is disabled by enterprise policy');

      // Terminal execution assertions
      const terminalCheck = engine.assertAllowed({ type: 'terminal_execution', target: 'git status' });
      expect(terminalCheck.allowed).toBe(false);
      expect(terminalCheck.reason).toContain('Terminal command execution is disabled by enterprise policy');

      // Feature assertions
      expect(engine.isFeatureAllowed('m3eCanvas')).toBe(false);
      expect(engine.isFeatureAllowed('ledgerExport')).toBe(true);
    });
  });

  describe('Fail-Safe Lockdown Mechanism', () => {
    it('collapses to most restrictive lockdown policy on invalid schema or corrupted JSON', async () => {
      const dotTycode = path.join(tmpWorkspace, '.tycode');
      await fs.mkdir(dotTycode, { recursive: true });

      // Write invalid policy (missing version, bad types)
      await fs.writeFile(
        path.join(dotTycode, 'enterprise-policy.json'),
        JSON.stringify({ org: 'Broken Corp', invalidField: true }),
        'utf8'
      );

      const engine = new PolicyEngine(tmpWorkspace);
      await engine.initialize();

      expect(engine.getPolicySource()).toBe('default');
      const policy = engine.getEffectivePolicy();

      // Verify lockdown attributes
      expect(policy.org).toBe('Fail-Safe Enterprise Lockdown');
      expect(policy.locked.modes.allowed).toEqual(['REVIEW']);
      expect(policy.locked.routing.freeModeEnabled).toBe(false);
      expect(policy.locked.terminalPolicy).toBe('disabled');
      expect(policy.locked.features.ledgerExport).toBe(false);

      // Any attempt to use BUILD or other modes is strictly forbidden in lockdown
      expect(engine.isModeAllowed('BUILD')).toBe(false);
      expect(engine.isModeAllowed('REVIEW')).toBe(true);
      expect(engine.isFreeRoutingAllowed()).toBe(false);
    });

    it('verifies that getMostRestrictivePolicy creates zero-trust isolation', () => {
      const restrictive = getMostRestrictivePolicy();
      expect(restrictive.locked.modes.locked).toBe(true);
      expect(restrictive.locked.modes.allowed).toEqual(['REVIEW']);
      expect(restrictive.locked.roles.locked).toBe(true);
      expect(restrictive.locked.roles.allowed).toEqual(['review']);
      expect(restrictive.locked.routing.freeModeEnabled).toBe(false);
      expect(restrictive.locked.terminalPolicy).toBe('disabled');
    });
  });

  describe('Hot-Reload Dynamics', () => {
    it('reloads policy dynamically on file update', async () => {
      const dotTycode = path.join(tmpWorkspace, '.tycode');
      await fs.mkdir(dotTycode, { recursive: true });

      const initialPolicy: EnterprisePolicy = {
        version: 1,
        org: 'Initial Org',
        locked: {
          terminalPolicy: 'always-ask',
          modes: { locked: true, allowed: ['REVIEW'], default: 'REVIEW' },
          roles: { locked: false, allowed: [], denied: [] },
          providers: { allowlist: [], denylist: [], requireLocalOnly: false },
          routing: { freeModeEnabled: true, fallbackEnabled: true, requireEncryptionInTransit: true },
          security: { workspaceContainment: 'standard', safeEditReviewGate: true, systemAccess: true },
          features: { m3eCanvas: false, ledgerExport: false },
          ledger: { retentionDays: 30, hashChainRequired: true }
        }
      };

      const policyFilePath = path.join(dotTycode, 'enterprise-policy.json');
      await fs.writeFile(policyFilePath, JSON.stringify(initialPolicy, null, 2), 'utf8');

      const engine = new PolicyEngine(tmpWorkspace);
      await engine.initialize();
      expect(engine.isModeAllowed('DESIGN')).toBe(false);

      // Update policy to allow DESIGN
      const updatedPolicy: EnterprisePolicy = {
        ...initialPolicy,
        org: 'Updated Org',
        locked: {
          ...initialPolicy.locked,
          modes: { locked: true, allowed: ['REVIEW', 'DESIGN'], default: 'REVIEW' }
        }
      };

      await fs.writeFile(policyFilePath, JSON.stringify(updatedPolicy, null, 2), 'utf8');
      await engine.reloadPolicy();

      expect(engine.getEffectivePolicy().org).toBe('Updated Org');
      expect(engine.isModeAllowed('DESIGN')).toBe(true);
    });
  });
});
