import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { adaptOpenMaicClassroomResponse } from '../../src/adapter.js';
import { normalizeClassroomPackageManifest } from '../../src/import/classroom-package.js';

describe('傅里叶课堂 package compatibility', () => {
  it('validates the exported 12-page classroom and preserves authored capabilities', () => {
    const archive = fileURLToPath(new URL('../../傅里叶变换入门.maic.zip', import.meta.url));
    const manifest = JSON.parse(execFileSync('unzip', ['-p', archive, 'manifest.json'], { encoding: 'utf8' })) as Record<string, unknown>;
    const classroom = normalizeClassroomPackageManifest(manifest, { stageId: 'fourier-transform-intro' });
    const adapted = adaptOpenMaicClassroomResponse({ success: true, classroom });
    const actionTypes = new Set(adapted.document.scenes.flatMap((scene) => (scene.actions ?? []).map((action) => action.type)));
    const elementTypes = new Set(adapted.document.scenes.flatMap((scene) => {
      const canvas = scene.content.canvas;
      return canvas && typeof canvas === 'object' && !Array.isArray(canvas) && Array.isArray((canvas as Record<string, unknown>).elements)
        ? ((canvas as Record<string, unknown>).elements as Array<{ type?: string }>).map((element) => element.type)
        : [];
    }));

    expect(adapted.scenes).toHaveLength(12);
    expect(adapted.participants).toHaveLength(5);
    expect(actionTypes).toEqual(new Set(['spotlight', 'speech', 'widget_highlight', 'widget_setState', 'laser', 'play_video', 'discussion']));
    expect(elementTypes).toEqual(new Set(['text', 'shape', 'image', 'video', 'latex', 'table', 'line']));
  });
});
