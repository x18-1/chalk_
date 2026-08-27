import { describe, expect, it } from 'vitest';
import {
  classroomPackageMediaReferences,
  normalizeClassroomPackageManifest,
} from '../../src/import/classroom-package.js';

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

  it('normalizes package media into stable artifact references without runtime URLs', () => {
    const result = normalizeClassroomPackageManifest({
      stage: { name: '媒体课堂' },
      scenes: [{
        type: 'slide',
        title: '第一节',
        content: { type: 'slide', canvas: { elements: [{ type: 'video', mediaRef: 'demo' }] } },
      }],
      mediaIndex: { 'media/demo.mp4': { mimeType: 'video/mp4' } },
    }, { stageId: 'media-classroom', mediaReference: (path) => path });

    expect((result.scenes as any[])[0].content.canvas.elements[0]).toMatchObject({
      mediaRef: 'media/demo.mp4',
    });
    expect((result.scenes as any[])[0].content.canvas.elements[0].src).toBeUndefined();
  });

  it('reports canvas and action media references for archive completeness checks', () => {
    expect(classroomPackageMediaReferences({
      scenes: [{
        content: {
          canvas: { elements: [{ type: 'image', src: 'diagram' }] },
        },
        actions: [{ type: 'speech', audioRef: 'media/narration.mp3' }],
      }],
      mediaIndex: {
        'media/diagram.png': { mimeType: 'image/png' },
        'media/narration.mp3': { mimeType: 'audio/mpeg' },
      },
    })).toEqual(['media/narration.mp3', 'media/diagram.png']);
  });
});
