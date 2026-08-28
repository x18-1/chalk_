import type { ClassroomOutline } from '../schemas';
import type { InteractiveWidgetType } from './interactive-document';

type SceneOutline = ClassroomOutline['outlines'][number];

/**
 * Converts the legacy OpenMAIC interactiveConfig shape into the canonical
 * widget contract. Keeping this at the generation boundary means persisted
 * drafts and every downstream stage observe the same widget type.
 */
export function normalizeInteractiveOutlines(outline: ClassroomOutline): ClassroomOutline {
  return {
    ...outline,
    outlines: outline.outlines.map(normalizeInteractiveOutline),
  };
}

export function normalizeInteractiveOutline(outline: SceneOutline): SceneOutline {
  if (outline.type !== 'interactive' || (outline.widgetType && outline.widgetOutline)) return outline;
  const legacy = outline.interactiveConfig;
  if (!legacy) return outline;

  const concept = textValue(legacy.conceptName) ?? outline.title;
  const widgetType = inferWidgetType(
    textValue(legacy.subject) ?? '',
    concept,
    textValue(legacy.designIdea) ?? '',
  );
  return {
    ...outline,
    widgetType,
    widgetOutline: buildWidgetOutline(widgetType, concept, textValue(legacy.designIdea) ?? ''),
  };
}

function inferWidgetType(subject: string, concept: string, designIdea: string): InteractiveWidgetType {
  const text = `${subject} ${concept} ${designIdea}`.toLowerCase();
  if (/physics|chemistry|力学|化学|运动|反应|force|motion|equilibrium|wave|电路|circuit/.test(text)) {
    return 'simulation';
  }
  if (/programming|code|algorithm|编程|算法|python|javascript|function|代码/.test(text)) return 'code';
  if (/process|workflow|步骤|流程|逻辑|step|flow|系统|system/.test(text)) return 'diagram';
  if (/biology|anatomy|cell|molecular|生物|细胞|分子|3d|三维|solar|planet|skeleton|organ/.test(text)) {
    return 'visualization3d';
  }
  if (/game|quiz|practice|练习|游戏|puzzle|match|challenge|挑战/.test(text)) return 'game';
  return 'simulation';
}

function buildWidgetOutline(widgetType: InteractiveWidgetType, concept: string, designIdea: string) {
  switch (widgetType) {
    case 'simulation':
      return { concept, ...(/variables|参数|调整|adjust|slider/i.test(designIdea) ? { keyVariables: [] } : {}) };
    case 'diagram':
      return { concept, diagramType: 'flowchart' };
    case 'code':
      return { concept, language: 'python' };
    case 'game':
      return { concept, gameType: 'quiz' };
    case 'visualization3d':
      return { concept, visualizationType: 'custom', objects: [] };
  }
}

function textValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
