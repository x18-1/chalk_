import { ToolRegistry, type RuntimeTool } from '@chalk/agent-runtime';

import {
  createRenameConversationTool,
  type ConversationTitleUpdater,
} from './tools/rename-conversation';
import {
  createSearchTool,
  type SearchProvider,
} from './tools/search';
import { createReadResourceTool, type ResourceReader } from './tools/read/read-resource';
import { createKnowledgeBaseSearchTool, type KnowledgeBaseQueryer } from './tools/knowledge-base-search';
import { createReadMemoryTool } from './tools/read-memory';
import { createWriteMemoryTool } from './tools/write-memory';
import type { MemoryService } from '../modules/memory/services/memory.service';
import { createRenderChalkboardTool } from './tools/render-chalkboard/tool';

export type { KnowledgeBaseQueryer } from './tools/knowledge-base-search';

export type BuiltinToolDependencies = {
  conversationTitleUpdater: ConversationTitleUpdater;
  searchProvider?: SearchProvider;
  readResourceReader?: ResourceReader;
  readCursorSecret?: string;
  readSkillTool?: RuntimeTool;
  knowledgeBaseQueryer?: KnowledgeBaseQueryer;
  knowledgeBaseId?: string;
  ownerId?: string;
  memory?: MemoryService;
};

export function createBuiltinToolRegistry(dependencies: BuiltinToolDependencies) {
  const tools: RuntimeTool[] = [
    createRenderChalkboardTool(),
    createRenameConversationTool(dependencies.conversationTitleUpdater),
  ];
  if (dependencies.searchProvider) tools.unshift(createSearchTool(dependencies.searchProvider));
  if (dependencies.readResourceReader && dependencies.readCursorSecret) {
    tools.unshift(createReadResourceTool(dependencies.readResourceReader, dependencies.readCursorSecret));
  }
  if (dependencies.readSkillTool) tools.unshift(dependencies.readSkillTool);
  if (dependencies.knowledgeBaseQueryer && dependencies.knowledgeBaseId && dependencies.ownerId) {
    tools.unshift(createKnowledgeBaseSearchTool(dependencies.knowledgeBaseQueryer, dependencies.ownerId, dependencies.knowledgeBaseId));
  }
  if (dependencies.memory) {
    tools.unshift(createWriteMemoryTool(dependencies.memory));
    tools.unshift(createReadMemoryTool(dependencies.memory));
  }
  return new ToolRegistry(tools);
}
