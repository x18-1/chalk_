export class AuthRequiredError extends Error {
  constructor(message = 'Authentication required') {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

export class OwnershipError extends Error {
  constructor(resource: string, resourceId: string) {
    super(`Access denied: ${resource} ${resourceId} not found or not owned by user`);
    this.name = 'OwnershipError';
  }
}

export class ToolApprovalAlreadyDecidedError extends Error {
  constructor(
    readonly toolCallId: string,
    readonly status: string,
  ) {
    super(`Tool approval ${toolCallId} has already been ${status}`);
    this.name = 'ToolApprovalAlreadyDecidedError';
  }
}

export class ToolApprovalNotActiveError extends Error {
  constructor(readonly toolCallId: string) {
    super(`Tool approval ${toolCallId} is not waiting for a decision`);
    this.name = 'ToolApprovalNotActiveError';
  }
}

