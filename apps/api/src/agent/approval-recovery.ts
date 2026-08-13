import type { Database } from '../db/client';
import { createToolApprovalsDal } from '../db/dal';

export type ToolApprovalRecoveryOptions = {
  timeoutMs: number;
  onError?: (error: unknown) => void;
};

export async function startToolApprovalRecovery(
  db: Database,
  options: ToolApprovalRecoveryOptions,
) {
  const approvals = createToolApprovalsDal(db);
  const recover = () => approvals.rejectExpiredPending(
    new Date(Date.now() - options.timeoutMs),
  );
  const recovered = await recover();
  const interval = setInterval(() => {
    void recover().catch(options.onError ?? (() => undefined));
  }, Math.min(options.timeoutMs, 30_000));
  interval.unref();

  return {
    recovered,
    stop() {
      clearInterval(interval);
    },
  };
}
