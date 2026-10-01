/*
 * Copyright 2026 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

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
  '@backstage-community/plugin-scaffolder-approvals-backend',
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
