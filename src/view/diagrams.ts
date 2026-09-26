import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';

/** A diagram language the server renders to SVG before the browser sees it. */
export type ServerDiagramKind = 'plantuml';

export type ServerDiagram = { svg: string } | { error: string };

export type ServerDiagramRenderer = (
  kind: ServerDiagramKind,
  source: string,
) => Promise<ServerDiagram>;

const SERVER_DIAGRAM_LANGUAGES: Record<string, ServerDiagramKind> = {
  plantuml: 'plantuml',
  puml: 'plantuml',
};

const RENDERERS: Record<
  ServerDiagramKind,
  (source: string) => Promise<ServerDiagram>
> = {
  plantuml: (source) => renderPlantUml(source),
};

const PLANTUML_TIMEOUT_MS = 30_000;
const rendered = new Map<string, Promise<ServerDiagram>>();

/** The server-rendered kind a fence language names, or null for browser-rendered fences. */
export function serverDiagramKind(
  language: string | null | undefined,
): ServerDiagramKind | null {
  return SERVER_DIAGRAM_LANGUAGES[language?.toLowerCase() ?? ''] ?? null;
}

/** Render once per distinct source for the life of the process; failures are retried. */
export const renderServerDiagram: ServerDiagramRenderer = (kind, source) => {
  const key = createHash('sha256').update(`${kind}\0${source}`).digest('hex');
  const cached = rendered.get(key);
  if (cached) return cached;
  const result = RENDERERS[kind](source);
  rendered.set(key, result);
  void result.then((diagram) => {
    if ('error' in diagram) rendered.delete(key);
  });
  return result;
};

/**
 * Run PlantUML in its SANDBOX profile: the bundled stdlib (C4, icons) loads,
 * but `!include` cannot read local files or URLs. `LAT_PLANTUML` names the
 * executable when `plantuml` is not on PATH.
 */
export function renderPlantUml(
  source: string,
  command = process.env.LAT_PLANTUML || 'plantuml',
): Promise<ServerDiagram> {
  const input = /^\s*@start/m.test(source)
    ? source
    : `@startuml\n${source}\n@enduml\n`;
  return new Promise((resolve) => {
    const child = execFile(
      command,
      [
        '-tsvg',
        '-pipe',
        '-charset',
        'UTF-8',
        '-DPLANTUML_SECURITY_PROFILE=SANDBOX',
      ],
      {
        encoding: 'utf8',
        maxBuffer: 20 * 1024 * 1024,
        timeout: PLANTUML_TIMEOUT_MS,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ svg: stdout });
          return;
        }
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          resolve({
            error: `PlantUML is not installed: install it, or set LAT_PLANTUML to its executable (tried "${command}")`,
          });
          return;
        }
        const detail = stderr
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line && line !== 'ERROR')
          .join(' ');
        resolve({
          error: error.killed
            ? `PlantUML timed out after ${PLANTUML_TIMEOUT_MS / 1000}s`
            : detail
              ? `PlantUML: ${detail}`
              : 'PlantUML could not render this diagram',
        });
      },
    );
    child.stdin?.end(input);
  });
}
