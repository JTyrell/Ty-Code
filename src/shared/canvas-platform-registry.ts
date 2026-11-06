/**
 * Canvas Platform Registry (Prompt 4 extension — Option B: Presets + AI prompt)
 *
 * Single source of truth for every Sketcher export target. Consumed by:
 *   - main: canvas-agent prompts, skeleton emitters, export orchestrator, Zod IPC
 *   - renderer: grouped target selector, device-frame resolution, export/copy labels
 *   - tests:  offline conformance suite (markers/bans/balance) + frame golden test
 *
 * Design note (locked in the plan): the export TARGET (this file's `CanvasTargetId`)
 * is deliberately decoupled from the structural node `CanvasPlatform` union
 * ('react'|'flutter'|'swiftui'|'web'|'other'). Adding a target here never widens
 * the node/AST/snapshot type, so existing canvas documents round-trip unchanged.
 * Device-frame geometry lives here (seeded from the pre-change `FrameForPlatform`
 * values) so "frames unchanged" holds by construction — see the golden test.
 */

export type CanvasTargetId =
  | 'react-web'
  | 'html-tailwind'
  | 'vue'
  | 'svelte'
  | 'angular'
  | 'react-native'
  | 'flutter'
  | 'compose'
  | 'swiftui';

export type CanvasTargetGroup = 'web' | 'mobile' | 'desktop';

export type CanvasFrameKind = 'phone' | 'desktop' | 'fill';

export interface CanvasDeviceFrame {
  kind: CanvasFrameKind;
  /** Point width, or 'fill' for a frame that fills its container. */
  width: number | 'fill';
  /** Point height, or 'fill' for a frame that fills its container. */
  height: number | 'fill';
  /** Top inset reserved for the device status/title bar (canvas units). */
  contentPadTop: number;
}

export type CanvasCodegen = 'skeleton+agent' | 'deterministic';

export interface CanvasPlatformEntry {
  id: CanvasTargetId;
  label: string;
  group: CanvasTargetGroup;
  /** Geometry ONLY. The renderer maps `kind` to titlebar/scale chrome separately. */
  deviceFrame: CanvasDeviceFrame;
  languageHint: string;
  /** Logical key into the prompt module (kept in code, not fs — deterministic). */
  systemPromptPath: string;
  /** 'skeleton+agent' now; flip to 'deterministic' per target later, zero UI change. */
  codegen: CanvasCodegen;
  /** Language id used for fenced blocks + gate labeling. */
  language: string;
  exportExtension: string;
  /** Substrings that MUST appear in the exported dialect for it to be valid. */
  validationMarkers: string[];
  /** Substrings that MUST NOT appear (TSX-leak guards for non-React targets). */
  bannedMarkers: string[];
}

// Stable, ordered list (launch priority: popular first, then additions).
export const CANVAS_TARGET_IDS = [
  'react-web',
  'flutter',
  'swiftui',
  'vue',
  'svelte',
  'react-native',
  'compose',
  'html-tailwind',
  'angular'
] as const satisfies readonly CanvasTargetId[];

const PHONE_FRAME: CanvasDeviceFrame = { kind: 'phone', width: 390, height: 780, contentPadTop: 26 };
const DESKTOP_FRAME: CanvasDeviceFrame = { kind: 'desktop', width: 920, height: 600, contentPadTop: 0 };
const FILL_FRAME: CanvasDeviceFrame = { kind: 'fill', width: 'fill', height: 'fill', contentPadTop: 0 };

// Shared TSX-leak guards for non-React dialects (amendment: bannedMarkers enforce
// that a non-React export never emits raw React TSX).
const WEB_TSX_LEAK_BANS = ['className=', 'import React'];

export const PLATFORM_REGISTRY: Record<CanvasTargetId, CanvasPlatformEntry> = {
  'react-web': {
    id: 'react-web',
    label: 'React + Tailwind',
    group: 'web',
    deviceFrame: FILL_FRAME,
    languageHint: 'TypeScript (React)',
    systemPromptPath: 'canvas-platform-prompts#react-web',
    codegen: 'skeleton+agent',
    language: 'tsx',
    exportExtension: '.tsx',
    validationMarkers: ['export default function', 'return ('],
    bannedMarkers: []
  },
  flutter: {
    id: 'flutter',
    label: 'Flutter',
    group: 'mobile',
    // Pilot dialect target — frame seeded from the pre-change phone geometry.
    deviceFrame: PHONE_FRAME,
    languageHint: 'Dart (Flutter)',
    systemPromptPath: 'canvas-platform-prompts#flutter',
    codegen: 'skeleton+agent',
    language: 'dart',
    exportExtension: '.dart',
    validationMarkers: ['Widget build(', 'package:flutter/material.dart'],
    bannedMarkers: WEB_TSX_LEAK_BANS
  },
  swiftui: {
    id: 'swiftui',
    label: 'SwiftUI',
    group: 'desktop',
    // Desktop-like in today's code (920x600). Seeded as-is; NOT "fixed" this pass.
    deviceFrame: DESKTOP_FRAME,
    languageHint: 'Swift (SwiftUI)',
    systemPromptPath: 'canvas-platform-prompts#swiftui',
    codegen: 'skeleton+agent',
    language: 'swift',
    exportExtension: '.swift',
    validationMarkers: ['struct', 'var body: some View'],
    bannedMarkers: WEB_TSX_LEAK_BANS
  },
  vue: {
    id: 'vue',
    label: 'Vue 3 (Nuxt)',
    group: 'web',
    deviceFrame: FILL_FRAME,
    languageHint: 'Vue 3 SFC',
    systemPromptPath: 'canvas-platform-prompts#vue',
    codegen: 'skeleton+agent',
    language: 'vue',
    exportExtension: '.vue',
    validationMarkers: ['<script setup>', '<template>'],
    bannedMarkers: [...WEB_TSX_LEAK_BANS, 'export default function']
  },
  svelte: {
    id: 'svelte',
    label: 'Svelte 5',
    group: 'web',
    deviceFrame: FILL_FRAME,
    languageHint: 'Svelte 5',
    systemPromptPath: 'canvas-platform-prompts#svelte',
    // Svelte SFC idiom is a <script>/<style> block, not `export default` — markers
    // assert the real `.svelte` shape so the dialect stays honest.
    codegen: 'skeleton+agent',
    language: 'svelte',
    exportExtension: '.svelte',
    validationMarkers: ['<script>', '</script>', '<style>'],
    bannedMarkers: [...WEB_TSX_LEAK_BANS, 'export default function']
  },
  'react-native': {
    id: 'react-native',
    label: 'React Native (Expo)',
    group: 'mobile',
    deviceFrame: PHONE_FRAME,
    languageHint: 'React Native (Expo)',
    systemPromptPath: 'canvas-platform-prompts#react-native',
    codegen: 'skeleton+agent',
    language: 'tsx',
    exportExtension: '.tsx',
    validationMarkers: ["from 'react-native'", 'StyleSheet'],
    bannedMarkers: ['className=']
  },
  compose: {
    id: 'compose',
    label: 'Jetpack Compose',
    group: 'mobile',
    deviceFrame: PHONE_FRAME,
    languageHint: 'Kotlin (Jetpack Compose)',
    systemPromptPath: 'canvas-platform-prompts#compose',
    codegen: 'skeleton+agent',
    language: 'kotlin',
    exportExtension: '.kt',
    validationMarkers: ['@Composable', 'import androidx.compose'],
    bannedMarkers: WEB_TSX_LEAK_BANS
  },
  'html-tailwind': {
    id: 'html-tailwind',
    label: 'HTML + Tailwind',
    group: 'web',
    deviceFrame: FILL_FRAME,
    languageHint: 'Vanilla HTML + Tailwind',
    systemPromptPath: 'canvas-platform-prompts#html-tailwind',
    codegen: 'skeleton+agent',
    language: 'html',
    exportExtension: '.html',
    validationMarkers: ['<!DOCTYPE html>', '<div'],
    bannedMarkers: [...WEB_TSX_LEAK_BANS, 'export default function']
  },
  angular: {
    id: 'angular',
    label: 'Angular (standalone)',
    group: 'web',
    deviceFrame: FILL_FRAME,
    languageHint: 'Angular standalone',
    systemPromptPath: 'canvas-platform-prompts#angular',
    codegen: 'skeleton+agent',
    language: 'typescript',
    exportExtension: '.component.ts',
    validationMarkers: ['@Component', 'selector:', 'template:'],
    bannedMarkers: [...WEB_TSX_LEAK_BANS, 'export default function']
  }
};

/** Registry entries in launch order. */
export const CANVAS_TARGET_LIST: CanvasPlatformEntry[] = CANVAS_TARGET_IDS.map((id) => PLATFORM_REGISTRY[id]);

export function getTarget(id: CanvasTargetId): CanvasPlatformEntry {
  return PLATFORM_REGISTRY[id];
}

/** Device-frame geometry for a target (single source; the frame golden test locks this). */
export function frameForTarget(id: CanvasTargetId): CanvasDeviceFrame {
  return PLATFORM_REGISTRY[id].deviceFrame;
}

export function isCanvasTargetId(value: unknown): value is CanvasTargetId {
  return typeof value === 'string' && (CANVAS_TARGET_IDS as readonly string[]).includes(value);
}

/** Grouped for the selector: web → mobile → desktop, each in launch order. */
export function targetsByGroup(): Array<{ group: CanvasTargetGroup; entries: CanvasPlatformEntry[] }> {
  const groups: CanvasTargetGroup[] = ['web', 'mobile', 'desktop'];
  return groups.map((group) => ({
    group,
    entries: CANVAS_TARGET_LIST.filter((entry) => entry.group === group)
  }));
}

/** React-family targets legitimately emit TSX; everything else must never leak it. */
export function isReactFamily(id: CanvasTargetId): boolean {
  return id === 'react-web' || id === 'react-native';
}

/** UI-honest dialect label, e.g. "Flutter — Dart (skeleton+agent dialect)". */
export function dialectLabel(id: CanvasTargetId): string {
  const entry = PLATFORM_REGISTRY[id];
  return `${entry.label} — ${entry.languageHint} (${entry.codegen} dialect)`;
}

/** Suggested default export path for a target (caller may override in the modal). */
export function defaultTargetPath(id: CanvasTargetId, componentName: string): string {
  const entry = PLATFORM_REGISTRY[id];
  const name = (componentName || 'GeneratedCanvasView').replace(/[^A-Za-z0-9_]/g, '') || 'GeneratedCanvasView';
  return `src/components/${name}${entry.exportExtension}`;
}
