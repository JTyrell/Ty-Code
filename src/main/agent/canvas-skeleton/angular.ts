/**
 * Angular standalone component skeleton — `@Component` with an inline `template`
 * string + `styles`. Exports a class (`export class`), never `export default`;
 * uses `class=` only, so no `className=` / `import React` TSX leak.
 */

import type { CanvasComponentNode } from '../../services/canvas-sync-manager';
import { safeComponentName } from './nodes';
import { renderDomList } from './renderDom';

const kebab = (value: string): string =>
  value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[_\s]+/g, '-').toLowerCase();

export function skeletonAngular(nodes: CanvasComponentNode[], componentName: string): string {
  const cls = safeComponentName(componentName);
  const selector = kebab(cls) || 'app-canvas';
  const body = renderDomList(nodes, '      ', 'class');
  return (
    `import { Component } from '@angular/core';\n\n` +
    `@Component({\n` +
    `  selector: 'app-${selector}',\n` +
    `  standalone: true,\n` +
    `  template: \`\n` +
    `    <div class="canvas-root">\n` +
    `${body}` +
    `    </div>\n` +
    `  \`,\n` +
    `  styles: [\`\n` +
    `    .canvas-root { border-radius: 16px; padding: 24px; }\n` +
    `  \`]\n` +
    `})\n` +
    `export class ${cls}Component {\n` +
    `}\n`
  );
}
