/**
 * React Native (Expo) skeleton. Emits RN components + StyleSheet (no web
 * `className=`). React-family (TSX) so `import React` is allowed; only the web
 * Tailwind leak marker is banned for this target.
 */

import type { CanvasComponentNode } from '../../services/canvas-sync-manager';
import { kids, nodeText, safeComponentName } from './nodes';

const esc = (value: string): string => value.replace(/"/g, '\\"');

function renderRn(node: CanvasComponentNode, indent: string): string {
  const children = kids(node);
  switch (node.type) {
    case 'button':
      return `${indent}<TouchableOpacity style={styles.item}>\n${indent}  <Text style={styles.itemText}>${esc(nodeText(node, 'Get Started'))}</Text>\n${indent}</TouchableOpacity>\n`;
    case 'input':
      return `${indent}<TextInput style={styles.input} placeholder="${esc(nodeText(node, 'Enter value'))}" />\n`;
    case 'text':
      return `${indent}<Text style={styles.text}>${esc(nodeText(node, 'Sample text'))}</Text>\n`;
    case 'image':
      return `${indent}<Image style={styles.image} />\n`;
    default:
      if (children.length > 0) {
        const inner = children.map((child) => renderRn(child, `${indent}  `)).join('');
        return `${indent}<View style={styles.item}>\n${inner}${indent}</View>\n`;
      }
      return `${indent}<View style={styles.item} />\n`;
  }
}

export function skeletonReactNative(nodes: CanvasComponentNode[], componentName: string): string {
  const name = safeComponentName(componentName);
  const body = nodes.map((node) => renderRn(node, '      ')).join('');
  return (
    `import React from 'react';\n` +
    `import { View, Text, TextInput, TouchableOpacity, Image, StyleSheet } from 'react-native';\n\n` +
    `export default function ${name}() {\n` +
    `  return (\n` +
    `    <View style={styles.root}>\n` +
    `${body}` +
    `    </View>\n` +
    `  );\n` +
    `}\n\n` +
    `const styles = StyleSheet.create({\n` +
    `  root: { flex: 1, padding: 24, backgroundColor: '#121316' },\n` +
    `  item: { borderRadius: 14, padding: 12, marginVertical: 6 },\n` +
    `  itemText: { color: '#ffffff', fontWeight: '600' },\n` +
    `  input: { borderRadius: 10, borderWidth: 1, padding: 10, marginVertical: 6 },\n` +
    `  text: { color: '#e7eaf6' },\n` +
    `  image: { width: 120, height: 120 },\n` +
    `});\n`
  );
}
