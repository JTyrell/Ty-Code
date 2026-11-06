/**
 * Shared DOM element renderer for the web-family skeletons
 * (react-web, html-tailwind, vue <template>, svelte markup, angular template).
 *
 * Emits a plain, balanced element tree. The only difference across dialects is
 * the class attribute name: React uses `className`, the rest use `class`. Keeping
 * one renderer guarantees bracket/tag balance across every web skeleton.
 */

import type { CanvasComponentNode } from '../../services/canvas-sync-manager';
import { kids, nodeText } from './nodes';

const tagFor = (type: string): string => {
  switch (type) {
    case 'button':
      return 'button';
    case 'input':
      return 'input';
    case 'text':
      return 'p';
    case 'image':
      return 'img';
    default:
      // container, card, list, divider, avatar, switch, checkbox, progress, and
      // any custom/project component render as a generic block element.
      return 'div';
  }
};

const esc = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Render one node (and its subtree) as a source line block.
 * @param classAttr 'className' for React/JSX, 'class' for HTML/Vue/Svelte/Angular.
 */
export function renderDomElement(node: CanvasComponentNode, indent: string, classAttr: string): string {
  const tag = tagFor(node.type);
  const cls = node.type;
  const children = kids(node);
  const open = `${indent}<${tag} ${classAttr}="${cls}"`;

  if (tag === 'input') {
    const placeholder = nodeText(node, 'Enter value');
    return `${open} placeholder="${esc(placeholder)}" />\n`;
  }
  if (tag === 'img') {
    return `${open} src="" alt="${esc(nodeText(node, 'Image'))}" />\n`;
  }

  if (children.length > 0) {
    const inner = children.map((child) => renderDomElement(child, `${indent}  `, classAttr)).join('');
    return `${open}>\n${inner}${indent}</${tag}>\n`;
  }

  const text = nodeText(node);
  return text ? `${open}>${esc(text)}</${tag}>\n` : `${open}></${tag}>\n`;
}

/** Render a whole node list with a shared indent + class attribute. */
export function renderDomList(nodes: CanvasComponentNode[], indent: string, classAttr: string): string {
  return nodes.map((node) => renderDomElement(node, indent, classAttr)).join('');
}
