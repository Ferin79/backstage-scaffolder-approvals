import {
  type DatabaseService,
  resolvePackagePath,
} from '@backstage/backend-plugin-api';
import { ApprovalStore } from './ApprovalStore';

/**
 * Resolved from the package name rather than relatively, so that it works both
 * from `src` in development and from the packed `dist` in a release, where the
 * migrations sit at a different depth.
 */
const migrationsDir = resolvePackagePath(
  '@ferin79/backstage-plugin-scaffolder-approvals-backend',
  'migrations',
);

/**
 * Run migrations if the deployment has not opted out, and build the store.
 *
 * `migrations.skip` is honoured because some deployments run migrations as a
 * separate, privileged step and give the running backend a read-only-DDL user.
 */
export async function initApprovalStore(
  database: DatabaseService,
  options: { now?: () => Date } = {},
): Promise<ApprovalStore> {
  const db = await database.getClient();

  if (!database.migrations?.skip) {
    await db.migrate.latest({ directory: migrationsDir });
  }

  return new ApprovalStore({ db, now: options.now });
}
