/** React + Tailwind (TSX) skeleton. React-family target: TSX output is legitimate. */

import type { CanvasComponentNode } from '../../services/canvas-sync-manager';
import { safeComponentName } from './nodes';
import { renderDomList } from './renderDom';

export function skeletonReactWeb(nodes: CanvasComponentNode[], componentName: string): string {
  const name = safeComponentName(componentName);
  const body = renderDomList(nodes, '      ', 'className');
  return (
    `export default function ${name}() {\n` +
    `  return (\n` +
    `    <div className="canvas-root">\n` +
    `${body}` +
    `    </div>\n` +
    `  );\n`
    + `}\n`
  );
}
