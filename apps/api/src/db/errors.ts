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
