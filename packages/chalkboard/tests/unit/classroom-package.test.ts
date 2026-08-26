import { describe, expect, it } from 'vitest';
import { normalizeClassroomPackageManifest } from '../../src/import/classroom-package.js';

describe('classroom package manifest adapter', () => {
  it('fills runtime ids and rewrites packaged media references', () => {
    const result = normalizeClassroomPackageManifest({
      stage: { name: '傅里叶变换入门' },
      agents: [{ name: '周砚', role: 'teacher' }],
      scenes: [{
        type: 'slide',
        title: '第一节',
        order: 1,
        content: { type: 'slide', canvas: { elements: [{ type: 'video', mediaRef: 'demo' }, { type: 'image', src: 'demo-image' }] } },
        actions: [{ type: 'play_video', elementId: 'video-1' }],
      }],
      mediaIndex: {
        'media/demo.mp4': { type: 'generated', mimeType: 'video/mp4' },
        'media/demo-image.png': { type: 'generated', mimeType: 'image/png' },
      },
    }, { stageId: 'fourier', mediaUrl: (path) => `/api/classroom-package-media/fourier/${path}` });

    expect(result).toMatchObject({
      id: 'fourier',
      stage: { id: 'fourier', name: '傅里叶变换入门' },
      scenes: [{ id: 'fourier-scene-1', stageId: 'fourier', actions: [{ id: 'fourier-scene-1-action-1' }] }],
    });
    expect((result.scenes as any[])[0].content.canvas.elements[0]).toMatchObject({
      src: '/api/classroom-package-media/fourier/media/demo.mp4',
    });
    expect((result.scenes as any[])[0].content.canvas.elements[1]).toMatchObject({
      src: '/api/classroom-package-media/fourier/media/demo-image.png',
    });
  });
});
