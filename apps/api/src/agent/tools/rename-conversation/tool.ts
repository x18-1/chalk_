import { Type, type Static } from 'typebox';

import type { RuntimeTool } from '@chalk/agent-runtime';

import { RENAME_CONVERSATION_PROMPT } from './prompts';

export type ConversationTitleUpdate = {
  ownerId: string;
  conversationId: string;
  title: string;
};

export type ConversationTitleUpdater = {
  update(input: ConversationTitleUpdate): Promise<{ title: string }>;
};

const renameParameters = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 120 }),
});

type RenameArguments = Static<typeof renameParameters>;

function cleanTitle(value: string) {
  const title = value.replace(/\s+/g, ' ').trim();
  if (!title) throw new Error('Conversation title cannot be empty');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(title)) {
    throw new Error('Conversation title contains a control character');
  }
  return title;
}

export function createRenameConversationTool(
  updater: ConversationTitleUpdater,
): RuntimeTool<typeof renameParameters> {
  return {
    name: 'rename_current_conversation',
    label: '修改会话标题',
    description: RENAME_CONVERSATION_PROMPT,
    parameters: renameParameters,
    source: 'chalk',
    effects: ['write'],
    approvalPolicy: 'required',
    defaultEnabled: true,
    requiresApproval: true,
    executionMode: 'sequential',
    async execute(args: RenameArguments, context) {
      if (!context.conversationId) {
        throw new Error('Renaming a conversation requires a conversation context');
      }
      const title = cleanTitle(args.title);
      const updated = await updater.update({
        ownerId: context.ownerId,
        conversationId: context.conversationId,
        title,
      });
      return {
        content: [{ type: 'text', text: `会话标题已更新为“${updated.title}”。` }],
        details: { conversationId: context.conversationId, title: updated.title },
      };
    },
  };
}
