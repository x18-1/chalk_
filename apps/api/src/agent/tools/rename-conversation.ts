/** Compatibility entrypoint; implementation lives in the feature folder. */
export {
  createRenameConversationTool,
  type ConversationTitleUpdate,
  type ConversationTitleUpdater,
} from './rename-conversation/tool';
export { RENAME_CONVERSATION_PROMPT } from './rename-conversation/prompts';
