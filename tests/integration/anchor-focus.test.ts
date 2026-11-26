import { describe, expect, it } from 'vitest';
import {
  anchorEvent,
  focusNow,
  onAnchor,
  revealThenFocus,
} from '../../apps/web/lib/ux/anchor-focus';

// Reveal, then focus (home page v4.3): the request is announced, the page opens what hides the target, and focus lands
// two frames later with tabindex -1 set; an id that is not on the page is reported, never focused.
function fakeElement() {
  const attrs = new Map<string, string>();
  const calls: string[] = [];
  return {
    attrs,
    calls,
    hasAttribute: (name: string) => attrs.has(name),
    setAttribute: (name: string, value: string) => attrs.set(name, value),
    focus: (options: unknown) => calls.push(`focus ${JSON.stringify(options)}`),
    scrollIntoView: (options: unknown) => calls.push(`scroll ${JSON.stringify(options)}`),
  };
}

describe('anchor focus', () => {
  it('focuses after two frames, without scrolling twice, and makes the target focusable', () => {
    const element = fakeElement();
    const queue: (() => void)[] = [];
    const found = focusNow(
      'example',
      { getElementById: () => element as unknown as HTMLElement },
      (cb) => queue.push(cb),
    );
    expect(found).toBe(true);
    expect(element.calls).toEqual([]);
    queue.shift()!();
    expect(element.calls).toEqual([]);
    queue.shift()!();
    expect(element.attrs.get('tabindex')).toBe('-1');
    expect(element.calls).toEqual(['focus {"preventScroll":true}', 'scroll {"block":"start"}']);
  });

  it('keeps a tabindex the element already has and reports a missing id', () => {
    const element = fakeElement();
    element.attrs.set('tabindex', '0');
    const queue: (() => void)[] = [];
    focusNow('a', { getElementById: () => element as unknown as HTMLElement }, (cb) =>
      queue.push(cb),
    );
    queue.shift()!();
    queue.shift()!();
    expect(element.attrs.get('tabindex')).toBe('0');
    expect(focusNow('missing', { getElementById: () => null }, () => undefined)).toBe(false);
  });

  it('announces the id on the window event, and stops after the cleanup', () => {
    const listeners = new Set<(event: Event) => void>();
    const target = {
      addEventListener: (_: string, fn: (event: Event) => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: (event: Event) => void) => listeners.delete(fn),
      dispatchEvent: (event: Event) => {
        listeners.forEach((fn) => fn(event));
        return true;
      },
    };
    const seen: string[] = [];
    const stop = onAnchor((id) => seen.push(id), target);
    revealThenFocus('route-delegation', target);
    expect(anchorEvent).toBe('corridra:anchor');
    stop();
    revealThenFocus('inbound', target);
    expect(seen).toEqual(['route-delegation']);
  });
});
