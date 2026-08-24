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

export type BuiltinToolDependencies = {
  conversationTitleUpdater: ConversationTitleUpdater;
  searchProvider?: SearchProvider;
  readResourceReader?: ResourceReader;
  readCursorSecret?: string;
  readSkillTool?: RuntimeTool;
};

export function createBuiltinToolRegistry(dependencies: BuiltinToolDependencies) {
  const tools: RuntimeTool[] = [createRenameConversationTool(dependencies.conversationTitleUpdater)];
  if (dependencies.searchProvider) tools.unshift(createSearchTool(dependencies.searchProvider));
  if (dependencies.readResourceReader && dependencies.readCursorSecret) {
    tools.unshift(createReadResourceTool(dependencies.readResourceReader, dependencies.readCursorSecret));
  }
  if (dependencies.readSkillTool) tools.unshift(dependencies.readSkillTool);
  return new ToolRegistry(tools);
}
