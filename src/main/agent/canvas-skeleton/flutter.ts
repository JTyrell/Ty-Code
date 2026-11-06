/**
 * Flutter (Dart) skeleton — a StatelessWidget whose build() wraps a Column of
 * SDK widgets. Pilot dialect target: markers are `Widget build(` + the material
 * import; banned are the React/TSX-leak guards. (StatelessWidget is asserted at
 * the skeleton level in the conformance suite, not as a required marker, so the
 * agent's StatefulWidget output still validates.)
 */

import type { CanvasComponentNode } from '../../services/canvas-sync-manager';
import { kids, nodeText, safeComponentName } from './nodes';

const esc = (value: string): string => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

function renderWidget(node: CanvasComponentNode, indent: string): string {
  const children = kids(node);
  switch (node.type) {
    case 'button':
      return `${indent}FilledButton(onPressed: () {}, child: const Text('${esc(nodeText(node, 'Get Started'))}')),\n`;
    case 'input':
      return `${indent}const TextField(decoration: InputDecoration(hintText: '${esc(nodeText(node, 'Enter value'))}')),\n`;
    case 'text':
      return `${indent}const Text('${esc(nodeText(node, 'Sample text'))}'),\n`;
    case 'image':
      return `${indent}const SizedBox(height: 120),\n`;
    default:
      if (children.length > 0) {
        const inner = children.map((child) => renderWidget(child, `${indent}    `)).join('');
        return `${indent}Container(\n${indent}  child: Column(\n${indent}    children: [\n${inner}${indent}    ],\n${indent}  ),\n${indent}),\n`;
      }
      return `${indent}const SizedBox(height: 24),\n`;
  }
}

export function skeletonFlutter(nodes: CanvasComponentNode[], componentName: string): string {
  const name = safeComponentName(componentName);
  const body = nodes.map((node) => renderWidget(node, '        ')).join('');
  return (
    `import 'package:flutter/material.dart';\n\n` +
    `class ${name} extends StatelessWidget {\n` +
    `  const ${name}({super.key});\n\n` +
    `  @override\n` +
    `  Widget build(BuildContext context) {\n` +
    `    return Container(\n` +
    `      color: const Color(0xFF121316),\n` +
    `      padding: const EdgeInsets.all(24),\n` +
    `      child: Column(\n` +
    `        crossAxisAlignment: CrossAxisAlignment.stretch,\n` +
    `        children: [\n` +
    `${body}` +
    `        ],\n` +
    `      ),\n` +
    `    );\n` +
    `  }\n` +
    `}\n`
  );
}
