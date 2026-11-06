/**
 * SwiftUI (Swift) skeleton — a `struct ...: View` with `var body: some View`.
 * Pilot dialect target: markers are `struct` + `var body: some View`.
 */

import type { CanvasComponentNode } from '../../services/canvas-sync-manager';
import { kids, nodeText, safeComponentName } from './nodes';

const esc = (value: string): string => value.replace(/"/g, '\\"');

function renderSwiftView(node: CanvasComponentNode, indent: string): string {
  const children = kids(node);
  switch (node.type) {
    case 'button':
      return `${indent}Button("${esc(nodeText(node, 'Get Started'))}") { }\n`;
    case 'input':
      return `${indent}TextField("${esc(nodeText(node, 'Enter value'))}", text: .constant(""))\n`;
    case 'text':
      return `${indent}Text("${esc(nodeText(node, 'Sample text'))}")\n`;
    case 'image':
      return `${indent}Image(systemName: "photo").frame(height: 120)\n`;
    default:
      if (children.length > 0) {
        const inner = children.map((child) => renderSwiftView(child, `${indent}    `)).join('');
        return `${indent}VStack(spacing: 12) {\n${inner}${indent}}\n`;
      }
      return `${indent}Spacer().frame(height: 8)\n`;
  }
}

export function skeletonSwiftUI(nodes: CanvasComponentNode[], componentName: string): string {
  const name = safeComponentName(componentName);
  const body = nodes.map((node) => renderSwiftView(node, '            ')).join('');
  return (
    `import SwiftUI\n\n` +
    `struct ${name}: View {\n` +
    `    var body: some View {\n` +
    `        VStack(spacing: 16) {\n` +
    `${body}` +
    `        }\n` +
    `        .padding(24)\n` +
    `        .background(Color(red: 0.07, green: 0.07, blue: 0.09))\n` +
    `    }\n` +
    `}\n`
  );
}
