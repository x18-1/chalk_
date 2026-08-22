import type { Database } from '../../../db/client';
import { createAuthUsersDal } from '../../../db/dal';
import type { UsersQuery } from '../schemas';

export class UserAdministrationService {
  private readonly users;

  constructor(db: Database) {
    this.users = createAuthUsersDal(db);
  }

  listUsers(adminUserId: string, query: UsersQuery) {
    return this.users.listForAdmin(adminUserId, {
      query: query.q,
      role: query.role,
      limit: query.limit,
      offset: query.offset,
    });
  }
}
