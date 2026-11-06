/**
 * Vue 3 SFC skeleton — `<template>` + `<script setup>` + `<style scoped>`.
 * Uses `class=` only (never `className=` / `import React` / `export default`).
 */

import type { CanvasComponentNode } from '../../services/canvas-sync-manager';
import { renderDomList } from './renderDom';

export function skeletonVue(nodes: CanvasComponentNode[], componentName: string): string {
  const tmpl = renderDomList(nodes, '      ', 'class');
  return (
    `<template>\n` +
    `  <div class="canvas-root">\n` +
    `${tmpl}` +
    `  </div>\n` +
    `</template>\n\n` +
    `<script setup>\n` +
    `// ${componentName || 'GeneratedCanvasView'} — Vue 3 SFC baseline dialect\n` +
    `</script>\n\n` +
    `<style scoped>\n` +
    `.canvas-root { border-radius: 16px; padding: 24px; }\n` +
    `</style>\n`
  );
}
