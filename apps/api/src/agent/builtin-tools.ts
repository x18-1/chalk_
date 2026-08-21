import { ToolRegistry } from '@chalk/agent-runtime';

import {
  createRenameConversationTool,
  type ConversationTitleUpdater,
} from './tools/rename-conversation';
import {
  createSearchTool,
  type SearchProvider,
} from './tools/search';

export type BuiltinToolDependencies = {
  conversationTitleUpdater: ConversationTitleUpdater;
  searchProvider?: SearchProvider;
};

export function createBuiltinToolRegistry(dependencies: BuiltinToolDependencies) {
  return new ToolRegistry([
    createSearchTool(dependencies.searchProvider),
    createRenameConversationTool(dependencies.conversationTitleUpdater),
  ]);
}
