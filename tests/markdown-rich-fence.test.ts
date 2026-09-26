// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import {
  MarkdownRichFence,
  parseMermaidSvg,
} from '../view/src/MarkdownRichFence.js';
import { getMermaid } from '../view/src/markdown-rich-fences.js';

describe('Markdown rich fences', () => {
  it('preserves HTML line breaks in Mermaid SVG labels', () => {
    const tree = parseMermaidSvg(`
      <svg xmlns="http://www.w3.org/2000/svg">
        <foreignObject><div xmlns="http://www.w3.org/1999/xhtml">
          <span>First<br>Second&nbsp;line</span>
        </div></foreignObject>
      </svg>
    `);

    expect(JSON.stringify(tree)).toContain('"tagName":"br"');
    expect(JSON.stringify(tree)).toContain('Second\u00a0line');
  });

  it('rejects output without a single SVG root', () => {
    for (const source of [
      'error',
      '<div>error</div>',
      '<svg></svg><div></div>',
    ]) {
      expect(() => parseMermaidSvg(source)).toThrow(
        'Mermaid did not return an SVG document',
      );
    }
  });

  it('renders multiline Mermaid labels into safe SVG trees', async () => {
    // jsdom has no SVG layout; only geometry is stubbed, not Mermaid rendering.
    const original = Object.getOwnPropertyDescriptor(
      SVGElement.prototype,
      'getBBox',
    );
    Object.defineProperty(SVGElement.prototype, 'getBBox', {
      configurable: true,
      value: vi.fn(() => ({ x: 0, y: 0, width: 100, height: 20 })),
    });
    try {
      const mermaid = await getMermaid();
      const diagrams = [
        'flowchart TB\n query["Search query"] --> results["Ranked sections<br/>with source spans"]',
        'flowchart LR\n cache{"Cached?"} -->|Yes| reuse["Reuse vector<br/>Skip embedding"]',
      ];
      for (const [index, source] of diagrams.entries()) {
        const { svg } = await mermaid.render(`multiline-test-${index}`, source);
        const tree = parseMermaidSvg(svg);
        expect(tree).toMatchObject({ type: 'element', tagName: 'svg' });
        expect(JSON.stringify(tree)).toContain('"tagName":"br"');
      }
    } finally {
      if (original)
        Object.defineProperty(SVGElement.prototype, 'getBBox', original);
      else Reflect.deleteProperty(SVGElement.prototype, 'getBBox');
    }
  });

  it('enlarges a Mermaid diagram on click and closes on backdrop or Escape', async () => {
    const original = Object.getOwnPropertyDescriptor(
      SVGElement.prototype,
      'getBBox',
    );
    Object.defineProperty(SVGElement.prototype, 'getBBox', {
      configurable: true,
      value: vi.fn(() => ({ x: 0, y: 0, width: 100, height: 20 })),
    });
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(
          createElement(MarkdownRichFence, {
            fallback: createElement('pre', null, 'source'),
            kind: 'mermaid',
            source: 'flowchart TB\n a["A"] --> b["B"]',
          }),
        );
      });
      await vi.waitFor(() =>
        expect(container.querySelector('.markdown-mermaid svg')).not.toBeNull(),
      );
      expect(
        container.querySelector('.code-block-copy')?.getAttribute('aria-label'),
      ).toBe('Copy PNG');

      const diagram = container.querySelector<HTMLElement>('.markdown-mermaid');
      await act(async () => diagram?.click());
      const backdrop = container.querySelector<HTMLElement>(
        '.diagram-lightbox-backdrop',
      );
      expect(backdrop?.querySelector('.diagram-lightbox svg')).not.toBeNull();

      await act(async () =>
        backdrop?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })),
      );
      expect(container.querySelector('.diagram-lightbox-backdrop')).toBeNull();

      await act(async () => diagram?.click());
      await act(async () =>
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })),
      );
      expect(container.querySelector('.diagram-lightbox-backdrop')).toBeNull();
    } finally {
      await act(async () => root.unmount());
      container.remove();
      if (original)
        Object.defineProperty(SVGElement.prototype, 'getBBox', original);
      else Reflect.deleteProperty(SVGElement.prototype, 'getBBox');
    }
  });

  it('reflects Mermaid SVG without executable nodes or properties', () => {
    const tree = parseMermaidSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" onclick="alert(1)">
        <a href="javascript:alert(2)"><text>safe</text></a>
        <script>alert(3)</script>
        <path d="M0 0L1 1" />
      </svg>
    `);

    expect(tree).toMatchObject({
      type: 'element',
      tagName: 'svg',
      properties: { xmlns: 'http://www.w3.org/2000/svg' },
    });
    expect(JSON.stringify(tree)).not.toContain('onclick');
    expect(JSON.stringify(tree)).not.toContain('javascript:');
    expect(JSON.stringify(tree)).not.toContain('script');
    expect(JSON.stringify(tree)).toContain('M0 0L1 1');
  });
});
