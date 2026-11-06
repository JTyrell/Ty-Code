/**
 * Jetpack Compose (Kotlin) skeleton — @Composable functions using material3 +
 * Modifier layout. Markers: `@Composable` + an androidx.compose import.
 */

import type { CanvasComponentNode } from '../../services/canvas-sync-manager';
import { kids, nodeText, safeComponentName } from './nodes';

const esc = (value: string): string => value.replace(/"/g, '\\"');

function renderComposable(node: CanvasComponentNode, indent: string): string {
  const children = kids(node);
  switch (node.type) {
    case 'button':
      return `${indent}Button(onClick = { }) { Text("${esc(nodeText(node, 'Get Started'))}") }\n`;
    case 'input':
      return `${indent}TextField(value = "", onValueChange = { }, label = { Text("${esc(nodeText(node, 'Enter value'))}") })\n`;
    case 'text':
      return `${indent}Text("${esc(nodeText(node, 'Sample text'))}")\n`;
    case 'image':
      return `${indent}Spacer(modifier = Modifier.height(120.dp))\n`;
    default:
      if (children.length > 0) {
        const inner = children.map((child) => renderComposable(child, `${indent}    `)).join('');
        return `${indent}Column(modifier = Modifier.fillMaxWidth()) {\n${inner}${indent}}\n`;
      }
      return `${indent}Spacer(modifier = Modifier.height(8.dp))\n`;
  }
}

export function skeletonCompose(nodes: CanvasComponentNode[], componentName: string): string {
  const name = safeComponentName(componentName);
  const body = nodes.map((node) => renderComposable(node, '        ')).join('');
  return (
    `import androidx.compose.foundation.layout.*\n` +
    `import androidx.compose.material3.*\n` +
    `import androidx.compose.runtime.Composable\n` +
    `import androidx.compose.ui.Modifier\n` +
    `import androidx.compose.ui.unit.dp\n\n` +
    `@Composable\n` +
    `fun ${name}() {\n` +
    `    Column(\n` +
    `        modifier = Modifier\n` +
    `            .fillMaxWidth()\n` +
    `            .padding(24.dp),\n` +
    `    ) {\n` +
    `${body}` +
    `    }\n` +
    `}\n`
  );
}
