import { describe, expect, it } from 'vitest';
import type { CanvasComponentNode } from '../src/main/services/canvas-sync-manager';
import {
  CANVAS_TARGET_IDS,
  PLATFORM_REGISTRY,
  getTarget,
  frameForTarget,
  isReactFamily,
  dialectLabel,
  defaultTargetPath,
  type CanvasTargetId
} from '../src/shared/canvas-platform-registry';
import { skeletonFor } from '../src/main/agent/canvas-skeleton';
import { validateDialect } from '../src/main/agent/canvas-export/validators';
import { getTargetSystemPrompt, CANVAS_TARGET_PROMPTS } from '../src/main/agent/canvas-platform-prompts';

/**
 * Prompt 4 extension — offline platform conformance (three-tier testability, tier 2).
 *
 * Runs every registry target's DETERMINISTIC skeleton emitter against a
 * representative AST and judges it with the SAME validator the live agent path
 * uses. No model, no network, no FS — this is the load-bearing proof that a
 * keyless/offline export always reaches the Safe Edit Gate as a valid dialect.
 * Lives under `tests/` so the src/main no-mock production guard stays untouched.
 */

// One node of every structural shape the emitters must survive.
const REPRESENTATIVE_AST: CanvasComponentNode[] = [
  {
    id: 'c1',
    type: 'container',
    name: 'Hero',
    props: { color: '#1e1b29' },
    children: [
      { id: 't1', type: 'text', props: { text: 'Welcome', fontSize: 20 } },
      { id: 'b1', type: 'button', props: { text: 'Get Started' } },
      { id: 'i1', type: 'input', props: { placeholder: 'Email' } },
      { id: 'img1', type: 'image', props: {} },
      {
        id: 'l1',
        type: 'list',
        props: {},
        children: [
          { id: 'r1', type: 'text', props: { text: 'Row 1' } },
          { id: 'r2', type: 'text', props: { text: 'Row 2' } }
        ]
      }
    ]
  }
];

const ALL_TARGETS = CANVAS_TARGET_IDS as readonly CanvasTargetId[];

describe('registry shape', () => {
  it('exposes exactly the 9 launch targets, all present in PLATFORM_REGISTRY', () => {
    expect(ALL_TARGETS).toHaveLength(9);
    for (const id of ALL_TARGETS) {
      expect(PLATFORM_REGISTRY[id]).toBeDefined();
      expect(getTarget(id).id).toBe(id);
    }
  });

  it('labels + default paths are dialect-honest per target', () => {
    for (const id of ALL_TARGETS) {
      const entry = getTarget(id);
      expect(dialectLabel(id)).toContain(entry.label);
      expect(dialectLabel(id)).toContain(`${entry.codegen} dialect`);
      const path = defaultTargetPath(id, 'My View!');
      expect(path.startsWith('src/components/MyView')).toBe(true);
      expect(path.endsWith(entry.exportExtension)).toBe(true);
    }
  });
});

describe('skeleton emitters satisfy the shared validator (offline)', () => {
  for (const id of ALL_TARGETS) {
    it(`${id}: every validationMarker present, no bannedMarker, balanced`, () => {
      const entry = getTarget(id);
      const code = skeletonFor(id, REPRESENTATIVE_AST, 'GeneratedCanvasView');
      expect(code.trim().length).toBeGreaterThan(0);
      for (const marker of entry.validationMarkers) expect(code).toContain(marker);
      for (const banned of entry.bannedMarkers) expect(code).not.toContain(banned);
      const result = validateDialect(code, entry);
      expect(result.failures).toEqual([]);
      expect(result.ok).toBe(true);
    });
  }
});

describe('negative controls: a broken dialect must fail validation', () => {
  for (const id of ALL_TARGETS) {
    it(`${id}: stripping a required marker fails`, () => {
      const entry = getTarget(id);
      const code = skeletonFor(id, REPRESENTATIVE_AST, 'GeneratedCanvasView');
      const marker = entry.validationMarkers[0];
      const mutated = code.split(marker).join('');
      expect(validateDialect(mutated, entry).ok).toBe(false);
    });
  }

  for (const id of ALL_TARGETS) {
    if (getTarget(id).bannedMarkers.length === 0) continue;
    it(`${id}: a React/TSX leak is rejected`, () => {
      const entry = getTarget(id);
      const code = `${skeletonFor(id, REPRESENTATIVE_AST, 'GeneratedCanvasView')}\nimport React from 'react';\nconst leak = <div className="x" />;\n`;
      const result = validateDialect(code, entry);
      expect(result.ok).toBe(false);
      expect(result.failures.some((f) => /leak/i.test(f))).toBe(true);
    });
  }

  it('empty output is rejected', () => {
    expect(validateDialect('   ', getTarget('react-web')).ok).toBe(false);
  });
});

describe('pilot-dialect positive assertions (Flutter / SwiftUI)', () => {
  it('Flutter skeleton is a StatelessWidget with a build() and the material import', () => {
    const code = skeletonFor('flutter', REPRESENTATIVE_AST, 'HomeScreen');
    expect(code).toContain('class HomeScreen extends StatelessWidget');
    expect(code).toContain('Widget build(BuildContext context)');
    expect(code).toContain("import 'package:flutter/material.dart'");
    expect(code).not.toContain('className=');
  });

  it('SwiftUI skeleton is a struct conforming to View with var body: some View', () => {
    const code = skeletonFor('swiftui', REPRESENTATIVE_AST, 'HomeScreen');
    expect(code).toContain('struct HomeScreen: View');
    expect(code).toContain('var body: some View');
    expect(code).not.toContain('import React');
  });

  it('React-family targets legitimately emit TSX; non-React never do', () => {
    expect(isReactFamily('react-web')).toBe(true);
    expect(isReactFamily('react-native')).toBe(true);
    expect(isReactFamily('vue')).toBe(false);
    const vue = skeletonFor('vue', REPRESENTATIVE_AST, 'HomeScreen');
    expect(vue).not.toContain('export default function');
  });
});

describe('frame golden test (amendment 5): geometry seeded from the pre-change FrameForPlatform', () => {
  // These literals are the EXACT geometry the pre-extension `FrameForPlatform`
  // returned (react/flutter phone 390x780 padTop26; swiftui 920x600 padTop0; web
  // fill). If a future edit changes a device frame, this test must be updated in
  // lockstep with the renderer — proving frames are unchanged by construction.
  const PHONE = { kind: 'phone', width: 390, height: 780, contentPadTop: 26 };
  const DESKTOP = { kind: 'desktop', width: 920, height: 600, contentPadTop: 0 };
  const FILL = { kind: 'fill', width: 'fill', height: 'fill', contentPadTop: 0 };

  it('phone targets carry the 390x780/26 frame', () => {
    for (const id of ['flutter', 'react-native', 'compose'] as CanvasTargetId[]) {
      expect(frameForTarget(id)).toEqual(PHONE);
    }
  });

  it('SwiftUI keeps its desktop-like 920x600/0 frame (not "fixed" this pass)', () => {
    expect(frameForTarget('swiftui')).toEqual(DESKTOP);
  });

  it('web-family targets fill their container', () => {
    for (const id of ['react-web', 'vue', 'svelte', 'html-tailwind', 'angular'] as CanvasTargetId[]) {
      expect(frameForTarget(id)).toEqual(FILL);
    }
  });
});

describe('prompt contract regression (tier 1 wiring): prompts embed their contract strings', () => {
  // The four MIGRATED prompts (react-web/react-native/flutter/swiftui) must keep
  // their exact prior contract strings, so we assert on stable idiom phrases
  // rather than the code-syntax `validationMarkers` (e.g. the RN prompt never
  // spells an `import ... from 'react-native'` line, yet its marker demands one).
  const CONTRACT_STRINGS: Record<CanvasTargetId, string[]> = {
    'react-web': ['Tailwind CSS utility classes', 'export default function'],
    'react-native': ["Imports ONLY from 'react' and 'react-native'", 'StyleSheet'],
    flutter: ['flutter/material.dart', 'Widget build(BuildContext context)'],
    swiftui: ['SwiftUI SDK only', 'var body: some View'],
    vue: ['<script setup>', '<template>', 'Vue 3 Single File Component'],
    svelte: ['$props', '<style>', 'Svelte 5'],
    compose: ['@Composable', 'androidx.compose'],
    'html-tailwind': ['<!DOCTYPE html>', 'Tailwind'],
    angular: ['@Component', 'selector:', 'template:']
  };
  for (const id of ALL_TARGETS) {
    it(`${id}: system prompt carries its contract strings + the output protocol`, () => {
      const prompt = getTargetSystemPrompt(id);
      expect(prompt).toBe(CANVAS_TARGET_PROMPTS[id]);
      for (const phrase of CONTRACT_STRINGS[id]) expect(prompt).toContain(phrase);
      expect(prompt).toContain('OUTPUT PROTOCOL');
    });
  }
});
