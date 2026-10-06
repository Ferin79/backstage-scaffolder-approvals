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

import { SCAFFOLDER_APPROVALS_PLUGIN_ID } from '@ferin79/backstage-plugin-scaffolder-approvals-common';
import type { LoggerService } from '@backstage/backend-plugin-api';
import type { EventsService } from '@backstage/plugin-events-node';
import type { ScaffolderTaskStatus } from '@backstage/plugin-scaffolder-common';
import type { ApprovalStore } from '../database';
import type { ApprovalSweeps } from './ApprovalSweeps';

/**
 * The topic the scaffolder publishes task lifecycle events on.
 *
 * `DatabaseTaskStore` publishes to it on task creation, on claim, on every
 * status change and on cancellation.
 *
 * The subscription is still written defensively, and stays an optimisation
 * rather than a guarantee: another plugin's payload shape is not this plugin's
 * to depend on. If it ever changes, nothing throws, no event matches, and the
 * reconciliation sweep remains the sole source of task status — costing a
 * request one sweep interval of staleness and nothing else.
 */
export const SCAFFOLDER_TASK_TOPIC = 'scaffolder.task';

/** The part of a task event this plugin cares about. */
interface TaskEventPayload {
  id?: string;
  taskId?: string;
  status?: ScaffolderTaskStatus;
}

/**
 * Read a task id and status out of an event payload, defensively.
 *
 * The payload comes from another plugin's contract, so this reads what it needs
 * and ignores everything else rather than assuming a shape. The scaffolder's
 * payloads are not uniform: most carry the task id as `id`, but the
 * cancellation event carries it as `taskId` and uses `id` for the id of its
 * task-event row. So `taskId` wins when present.
 */
export function readTaskEvent(
  payload: unknown,
): { taskId: string; status: ScaffolderTaskStatus } | undefined {
  if (typeof payload !== 'object' || payload === null) {
    return undefined;
  }

  const { id, taskId, status } = payload as TaskEventPayload;
  const resolved = typeof taskId === 'string' ? taskId : id;

  if (typeof resolved !== 'string' || !resolved || typeof status !== 'string') {
    return undefined;
  }

  return { taskId: resolved, status };
}

/**
 * Subscribe to scaffolder task events so a finished run updates its request
 * without waiting for the next reconciliation sweep, which remains the
 * backstop.
 */
export async function subscribeToTaskEvents(options: {
  events: EventsService;
  store: ApprovalStore;
  sweeps: ApprovalSweeps;
  logger: LoggerService;
}): Promise<void> {
  const { events, store, sweeps, logger } = options;

  await events.subscribe({
    id: SCAFFOLDER_APPROVALS_PLUGIN_ID,
    topics: [SCAFFOLDER_TASK_TOPIC],
    async onEvent(params) {
      const event = readTaskEvent(params.eventPayload);
      if (!event) {
        return;
      }

      // Most scaffolder tasks have nothing to do with approvals, so finding no
      // request is the common case rather than a problem.
      const request = await store.findRequestByTaskId(event.taskId);
      if (!request) {
        return;
      }

      try {
        await sweeps.applyTaskStatus(request, event.status);
      } catch (error) {
        // The sweep will catch up; an event handler that throws helps nobody.
        logger.warn(
          `Could not apply task ${event.taskId} status to approval request ${request.id}`,
          error instanceof Error ? error : undefined,
        );
      }
    },
  });
}
