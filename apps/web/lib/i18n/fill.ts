import { createElement, Fragment, isValidElement, type ReactNode } from 'react';

/** Puts values into a message pattern such as "Show {count} more". An unknown name is left as written. */
export function fill(pattern: string, values: Record<string, string | number>): string {
  return pattern.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : whole,
  );
}

/**
 * Puts values that may be elements into a message pattern, by the same `{name}` rule as `fill`. A string value
 * becomes part of the text around it; any other value (a number or an element) is its own node, as `{value}` is in
 * JSX. So a pattern filled only with strings gives one plain string, and the nodes match the JSX they replace.
 */
export function fillNodes(pattern: string, values: Record<string, ReactNode>): ReactNode {
  const nodes: ReactNode[] = [];
  let text = '';
  for (const [index, part] of pattern.split(/(\{\w+\})/).entries()) {
    const name = index % 2 === 1 ? part.slice(1, -1) : null;
    const value = name !== null && Object.hasOwn(values, name) ? values[name] : part;
    if (typeof value === 'string') {
      text += value;
      continue;
    }
    if (text) nodes.push(text);
    text = '';
    nodes.push(isValidElement(value) ? createElement(Fragment, { key: index }, value) : value);
  }
  if (text) nodes.push(text);
  return nodes.length === 1 && typeof nodes[0] === 'string' ? nodes[0] : nodes;
}
