/**
 * Svelte 5 skeleton — `<script>` (runes) + markup + `<style>`. Uses `class=` only;
 * never `className=` / `import React` / `export default function` (a `.svelte`
 * component has no default export — that would be a TSX leak, so we ban it).
 */

import type { CanvasComponentNode } from '../../services/canvas-sync-manager';
import { renderDomList } from './renderDom';

export function skeletonSvelte(nodes: CanvasComponentNode[], _componentName: string): string {
  const markup = renderDomList(nodes, '  ', 'class');
  return (
    `<script>\n` +
    `  let { title = 'Welcome' } = $props();\n` +
    `</script>\n\n` +
    `<div class="canvas-root">\n` +
    `${markup}` +
    `</div>\n\n` +
    `<style>\n` +
    `  .canvas-root { border-radius: 16px; padding: 24px; }\n` +
    `</style>\n`
  );
}
