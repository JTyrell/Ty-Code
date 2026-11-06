import { describe, expect, it } from 'vitest';
import { getTarget, type CanvasTargetId } from '../src/shared/canvas-platform-registry';
import { validateDialect, formatFailuresForRetry } from '../src/main/agent/canvas-export/validators';

/**
 * Prompt 4 extension — validator unit tests (tier 3). One validator, two
 * producers: the SAME rules judge the agent and the skeleton, so here we drive
 * it with hand-written synthetic snippets (valid + each failure class) rather
 * than emitter output. Pure + synchronous; runs offline in the Node suite.
 */

const VALID: Record<CanvasTargetId, string> = {
  'react-web': `export default function Home() {\n  return (\n    <div className="p-6"><button>Go</button></div>\n  );\n}`,
  'react-native': `import { View, StyleSheet } from 'react-native';\nexport default function Home() {\n  return <View style={styles.box} />;\n}\nconst styles = StyleSheet.create({ box: { padding: 24 } });`,
  flutter: `import 'package:flutter/material.dart';\nclass Home extends StatelessWidget {\n  @override\n  Widget build(BuildContext context) {\n    return const Text('Hi');\n  }\n}`,
  swiftui: `import SwiftUI\nstruct Home: View {\n    var body: some View {\n        Text("Hi")\n    }\n}`,
  vue: `<template>\n  <div class="hero">Hi</div>\n</template>\n\n<script setup>\nconst x = 1;\n</script>\n\n<style scoped>\n.hero { padding: 24px; }\n</style>`,
  svelte: `<script>\n  let x = 1;\n</script>\n\n<div>Hi</div>\n\n<style>\n  div { padding: 24px; }\n</style>`,
  compose: `import androidx.compose.material3.Text\nimport androidx.compose.runtime.Composable\n\n@Composable\nfun Home() {\n    Text("Hi")\n}`,
  'html-tailwind': `<!DOCTYPE html>\n<html><body>\n  <div class="p-6">Hi</div>\n</body></html>`,
  angular: `import { Component } from '@angular/core';\n\n@Component({\n  selector: 'app-home',\n  standalone: true,\n  template: \`<div>Hi</div>\`\n})\nexport class HomeComponent {}`
};

describe('validateDialect accepts a well-formed dialect per platform', () => {
  (Object.keys(VALID) as CanvasTargetId[]).forEach((id) => {
    it(`${id}`, () => {
      const result = validateDialect(VALID[id], getTarget(id));
      expect(result.failures).toEqual([]);
      expect(result.ok).toBe(true);
    });
  });
});

describe('validateDialect rejects each failure class', () => {
  it('empty / whitespace output', () => {
    expect(validateDialect('', getTarget('flutter')).ok).toBe(false);
    expect(validateDialect('   \n  ', getTarget('vue')).failures[0]).toMatch(/Empty/);
  });

  it('missing a required marker', () => {
    const noMarker = `class Home {\n  void go() {}\n}`;
    const result = validateDialect(noMarker, getTarget('flutter'));
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => /Missing required/.test(f))).toBe(true);
  });

  it('banned React/TSX leak in a non-React dialect', () => {
    const leak = `import 'package:flutter/material.dart';\nWidget build(x) => Text('a'); // className= foo\n`;
    const result = validateDialect(leak, getTarget('flutter'));
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => /leak/i.test(f))).toBe(true);
  });

  it('unbalanced brackets', () => {
    // Tags balance, but the function's closing `}` is dropped -> a real bracket fault.
    const unbalanced = `export default function Home() { return (<div>Hi</div>);`;
    const result = validateDialect(unbalanced, getTarget('react-web'));
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => /Unbalanced brackets/.test(f))).toBe(true);
  });

  it('unbalanced markup tags in a tag-based dialect', () => {
    // Brackets + all markers are fine; a stray unmatched `</span>` fails the tag scan.
    const badTags = `<template>\n  <div class="hero">Hi</div>\n</template>\n\n<script setup>\nconst x = 1;\n</script>\n</span>`;
    const result = validateDialect(badTags, getTarget('vue'));
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => /Unbalanced markup/.test(f))).toBe(true);
  });

  it('non-tag dialects skip the tag scan (braces only)', () => {
    // Swift has no markup; angle brackets inside generics must not be parsed as tags.
    const swift = `import SwiftUI\nstruct Home: View {\n    var body: some View {\n        VStack<Text> { Text("hi") }\n    }\n}`;
    expect(validateDialect(swift, getTarget('swiftui')).ok).toBe(true);
  });
});

describe('formatFailuresForRetry', () => {
  it('renders a bulleted block the retry prompt can append', () => {
    const text = formatFailuresForRetry(['Missing required marker: x', 'Unbalanced brackets ( ) [ ] { }.']);
    expect(text).toContain('  - Missing required marker: x');
    expect(text).toContain('  - Unbalanced brackets');
  });
});
