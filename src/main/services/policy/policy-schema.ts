/**
 * Ty-Code Enterprise Policy Schema & Types
 *
 * Implements Zod validation for enterprise policy files and OS-level MDM policies.
 *
 * Brand: Ty-Code
 */

import { z } from 'zod';
import type { ModeId } from '../../agent/prompt-assembler/schemas';

export const TerminalPolicyEnum = z.enum(['always-ask', 'safe-auto', 'disabled']);
export type TerminalPolicy = z.infer<typeof TerminalPolicyEnum>;

export const PolicyModesSchema = z.object({
  allowed: z.array(z.enum(['BUILD', 'REVIEW', 'EXPLAIN', 'DESIGN', 'SHIP'])),
  default: z.enum(['BUILD', 'REVIEW', 'EXPLAIN', 'DESIGN', 'SHIP']),
  locked: z.boolean().default(true)
});
export type PolicyModes = z.infer<typeof PolicyModesSchema>;

export const PolicyRolesSchema = z.object({
  allowed: z.array(z.string()),
  denied: z.array(z.string()).default([]),
  locked: z.boolean().default(true)
});
export type PolicyRoles = z.infer<typeof PolicyRolesSchema>;

export const PolicyProvidersSchema = z.object({
  allowlist: z.array(z.string()),
  denylist: z.array(z.string()).default([]),
  requireLocalOnly: z.boolean().default(false)
});
export type PolicyProviders = z.infer<typeof PolicyProvidersSchema>;

export const PolicyRoutingSchema = z.object({
  freeModeEnabled: z.boolean().default(false),
  fallbackEnabled: z.boolean().default(true),
  requireEncryptionInTransit: z.boolean().default(true)
});
export type PolicyRouting = z.infer<typeof PolicyRoutingSchema>;

export const PolicySecuritySchema = z.object({
  workspaceContainment: z.enum(['strict', 'standard', 'relaxed']).default('strict'),
  safeEditReviewGate: z.boolean().default(true),
  systemAccess: z.boolean().default(false)
});
export type PolicySecurity = z.infer<typeof PolicySecuritySchema>;

export const PolicyFeaturesSchema = z.object({
  m3eCanvas: z.boolean().default(false),
  ledgerExport: z.boolean().default(true)
});
export type PolicyFeatures = z.infer<typeof PolicyFeaturesSchema>;

export const PolicyLedgerSchema = z.object({
  retentionDays: z.number().int().positive().default(365),
  hashChainRequired: z.boolean().default(true)
});
export type PolicyLedger = z.infer<typeof PolicyLedgerSchema>;

export const PolicyLockedSchema = z.object({
  terminalPolicy: TerminalPolicyEnum.default('always-ask'),
  modes: PolicyModesSchema,
  roles: PolicyRolesSchema,
  providers: PolicyProvidersSchema,
  routing: PolicyRoutingSchema,
  security: PolicySecuritySchema,
  features: PolicyFeaturesSchema,
  ledger: PolicyLedgerSchema
});
export type PolicyLocked = z.infer<typeof PolicyLockedSchema>;

export const PolicyAttestationSchema = z.object({
  alg: z.enum(['ed25519', 'rsa-sha256']),
  signedBy: z.string(),
  signature: z.string()
});
export type PolicyAttestation = z.infer<typeof PolicyAttestationSchema>;

export const EnterprisePolicySchema = z.object({
  $schema: z.string().optional(),
  version: z.union([z.number(), z.string()]),
  org: z.string().min(1),
  locked: PolicyLockedSchema,
  attestation: PolicyAttestationSchema.optional()
});
export type EnterprisePolicy = z.infer<typeof EnterprisePolicySchema>;

/**
 * Fail-safe: when invalid schema or failed signature is detected,
 * locked keys collapse to the most-restrictive defaults.
 */
export function getMostRestrictivePolicy(orgName = 'Fail-Safe Enterprise Lockdown'): EnterprisePolicy {
  return {
    version: 1,
    org: orgName,
    locked: {
      terminalPolicy: 'disabled',
      modes: {
        allowed: ['REVIEW'],
        default: 'REVIEW',
        locked: true
      },
      roles: {
        allowed: ['review'],
        denied: ['*'],
        locked: true
      },
      providers: {
        allowlist: ['local', 'ollama'],
        denylist: ['*'],
        requireLocalOnly: true
      },
      routing: {
        freeModeEnabled: false,
        fallbackEnabled: false,
        requireEncryptionInTransit: true
      },
      security: {
        workspaceContainment: 'strict',
        safeEditReviewGate: true,
        systemAccess: false
      },
      features: {
        m3eCanvas: false,
        ledgerExport: false
      },
      ledger: {
        retentionDays: 365,
        hashChainRequired: true
      }
    }
  };
}

/**
 * Built-in default policy when no enterprise policy is deployed.
 * Permissive with standard safety gates.
 */
export function getDefaultPolicy(): EnterprisePolicy {
  return {
    version: 1,
    org: 'Ty-Code Community Defaults',
    locked: {
      terminalPolicy: 'always-ask',
      modes: {
        allowed: ['BUILD', 'REVIEW', 'EXPLAIN', 'DESIGN', 'SHIP'],
        default: 'BUILD',
        locked: false
      },
      roles: {
        allowed: [], // empty means all permitted
        denied: [],
        locked: false
      },
      providers: {
        allowlist: [], // empty means all permitted
        denylist: [],
        requireLocalOnly: false
      },
      routing: {
        freeModeEnabled: true,
        fallbackEnabled: true,
        requireEncryptionInTransit: true
      },
      security: {
        workspaceContainment: 'standard',
        safeEditReviewGate: true,
        systemAccess: true
      },
      features: {
        m3eCanvas: true,
        ledgerExport: true
      },
      ledger: {
        retentionDays: 365,
        hashChainRequired: true
      }
    }
  };
}
