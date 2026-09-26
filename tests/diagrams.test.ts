import { execFileSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { renderPlantUml } from '../src/view/diagrams';
import { renderMarkdown } from '../src/view/markdown';
import type {
  ViewDocumentElement,
  ViewDocumentNode,
} from '../src/view/protocol';

function findPre(nodes: ViewDocumentNode[]): ViewDocumentElement | undefined {
  for (const node of nodes) {
    if (node.type !== 'element') continue;
    if (node.tagName === 'pre') return node;
    const found = findPre(node.children);
    if (found) return found;
  }
  return undefined;
}

function plantUmlInstalled(): boolean {
  try {
    execFileSync(process.env.LAT_PLANTUML || 'plantuml', ['-version'], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

describe('server-rendered diagrams', () => {
  it('attaches the rendered SVG to plantuml and puml fences', async () => {
    const renderDiagram = vi.fn(async () => ({ svg: '<svg></svg>' }));
    for (const language of ['plantuml', 'puml']) {
      const { tree } = await renderMarkdown(
        `# Doc\n\n\`\`\`${language}\nA -> B\n\`\`\`\n`,
        'doc.md',
        undefined,
        { renderDiagram },
      );
      const pre = findPre(tree.children);
      expect(pre?.properties.className).toContain('markdown-plantuml-source');
      expect(pre?.properties.dataDiagramSvg).toBe('<svg></svg>');
    }
    expect(renderDiagram).toHaveBeenCalledWith('plantuml', 'A -> B');
  });

  it('attaches the render error instead of an SVG when rendering fails', async () => {
    const { tree } = await renderMarkdown(
      '```plantuml\nbroken\n```\n',
      'doc.md',
      undefined,
      { renderDiagram: async () => ({ error: 'PlantUML: Syntax Error?' }) },
    );
    const pre = findPre(tree.children);
    expect(pre?.properties.dataDiagramError).toBe('PlantUML: Syntax Error?');
    expect(pre?.properties.dataDiagramSvg).toBeUndefined();
  });

  it('leaves browser-rendered fences to the browser', async () => {
    const renderDiagram = vi.fn();
    await renderMarkdown(
      '```mermaid\nflowchart TB\n```\n',
      'doc.md',
      undefined,
      {
        renderDiagram,
      },
    );
    expect(renderDiagram).not.toHaveBeenCalled();
  });

  it('names the missing executable when PlantUML is not installed', async () => {
    const result = await renderPlantUml('A -> B', '/nonexistent/plantuml');
    expect(result).toEqual({
      error: expect.stringContaining('PlantUML is not installed'),
    });
  });

  it.skipIf(!plantUmlInstalled())(
    'renders the C4 stdlib but refuses local file includes',
    async () => {
      const c4 = await renderPlantUml(
        '!include <C4/C4_Context>\nPerson(user, "User")\n',
      );
      expect(c4).toEqual({ svg: expect.stringContaining('<svg') });

      const include = await renderPlantUml('!include /etc/hosts\n');
      expect(include).toEqual({ error: expect.stringContaining('PlantUML') });
    },
    30_000,
  );
});
