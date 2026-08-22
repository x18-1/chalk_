import { listRuntimeSpans } from '../../../agent/telemetry';
import type { Database } from '../../../db/client';
import { createAgentRunObservationsDal } from '../../../db/dal';

export class TelemetryQueryService {
  private readonly observations;

  constructor(db: Database) {
    this.observations = createAgentRunObservationsDal(db);
  }

  listRecentSpans(adminUserId: string) {
    return { spans: listRuntimeSpans(adminUserId).slice(-100) };
  }

  async listConversations(adminUserId: string, limit: number, offset: number) {
    return {
      conversations: await this.observations.listConversationSummariesForAdmin(
        adminUserId,
        limit,
        offset,
      ),
    };
  }

  async getConversation(adminUserId: string, conversationId: string, limit: number) {
    const summary = await this.observations.getConversationSummaryForAdmin(
      adminUserId,
      conversationId,
    );
    if (!summary) return { summary: null, runs: [] };
    return {
      summary,
      runs: await this.observations.listForConversationForAdmin(
        adminUserId,
        conversationId,
        limit,
      ),
    };
  }
}
