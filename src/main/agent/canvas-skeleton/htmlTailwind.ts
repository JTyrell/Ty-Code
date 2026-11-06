/**
 * Vanilla HTML + Tailwind skeleton. Uses `class=` (never `className=`), so the
 * web-TSX-leak guard passes with the emitted `<div class="...">` and no React.
 */

import type { CanvasComponentNode } from '../../services/canvas-sync-manager';
import { renderDomList } from './renderDom';

export function skeletonHtmlTailwind(nodes: CanvasComponentNode[], _componentName: string): string {
  const body = renderDomList(nodes, '      ', 'class');
  return (
    `<!DOCTYPE html>\n` +
    `<html lang="en">\n` +
    `  <head>\n` +
    `    <meta charset="utf-8" />\n` +
    `    <script src="https://cdn.tailwindcss.com"></script>\n` +
    `  </head>\n` +
    `  <body>\n` +
    `    <div class="canvas-root">\n` +
    `${body}` +
    `    </div>\n` +
    `  </body>\n` +
    `</html>\n`
  );
}
