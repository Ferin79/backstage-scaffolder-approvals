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

import type { ApprovalRequest } from '@backstage-community/plugin-scaffolder-approvals-common';
import { mockServices } from '@backstage/backend-test-utils';
import type {
  EventParams,
  EventsService,
  EventsServiceSubscribeOptions,
} from '@backstage/plugin-events-node';
import type { ApprovalStore } from '../database';
import type { ApprovalSweeps } from './ApprovalSweeps';
import {
  readTaskEvent,
  SCAFFOLDER_TASK_TOPIC,
  subscribeToTaskEvents,
} from './subscribeToTaskEvents';

const REQUEST = {
  id: '3f1e4c8a-0000-4000-8000-000000000001',
  taskId: 'task-1',
  status: 'running',
} as ApprovalRequest;

describe('readTaskEvent', () => {
  it('reads a task id and status from either spelling', () => {
    // The payload belongs to another plugin's contract, so both plausible
    // spellings are accepted rather than betting on one.
    expect(readTaskEvent({ id: 'task-1', status: 'completed' })).toEqual({
      taskId: 'task-1',
      status: 'completed',
    });
    expect(readTaskEvent({ taskId: 'task-1', status: 'failed' })).toEqual({
      taskId: 'task-1',
      status: 'failed',
    });
  });

  it('prefers taskId when a payload carries both', () => {
    expect(
      readTaskEvent({ id: 'event-1', taskId: 'task-1', status: 'completed' }),
    ).toEqual({ taskId: 'task-1', status: 'completed' });
  });

  it('ignores anything it cannot read, rather than throwing', () => {
    // A payload this cannot understand means the fast path does nothing and
    // the sweep remains the source of truth — which is why it must be quiet.
    for (const payload of [
      undefined,
      null,
      'a string',
      42,
      {},
      { id: 'task-1' },
      { status: 'completed' },
      { id: '', status: 'completed' },
      { id: 123, status: 'completed' },
      { id: 'task-1', status: 42 },
    ]) {
      expect(readTaskEvent(payload)).toBeUndefined();
    }
  });

  it('carries extra fields through without complaint', () => {
    expect(
      readTaskEvent({
        id: 'task-1',
        status: 'completed',
        createdBy: 'user:default/x',
        spec: {},
      }),
    ).toEqual({ taskId: 'task-1', status: 'completed' });
  });
});

describe('subscribeToTaskEvents', () => {
  let onEvent: (params: EventParams) => Promise<void>;
  let subscribe: jest.Mock;
  let findRequestByTaskId: jest.Mock;
  let applyTaskStatus: jest.Mock;
  let logger: ReturnType<typeof mockServices.logger.mock>;

  beforeEach(async () => {
    subscribe = jest.fn(async (options: EventsServiceSubscribeOptions) => {
      onEvent = options.onEvent;
    });
    findRequestByTaskId = jest.fn().mockResolvedValue(REQUEST);
    applyTaskStatus = jest.fn();
    logger = mockServices.logger.mock();

    await subscribeToTaskEvents({
      events: { subscribe } as unknown as EventsService,
      store: { findRequestByTaskId } as unknown as ApprovalStore,
      sweeps: { applyTaskStatus } as unknown as ApprovalSweeps,
      logger,
    });
  });

  it('subscribes to the scaffolder task topic', () => {
    expect(subscribe).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'scaffolder-approvals',
        topics: [SCAFFOLDER_TASK_TOPIC],
      }),
    );
  });

  it('applies the task status to the matching request', async () => {
    await onEvent({
      topic: SCAFFOLDER_TASK_TOPIC,
      eventPayload: { id: 'task-1', status: 'completed' },
    });

    expect(findRequestByTaskId).toHaveBeenCalledWith('task-1');
    expect(applyTaskStatus).toHaveBeenCalledWith(REQUEST, 'completed');
  });

  it('ignores a task this plugin did not launch', async () => {
    // Most scaffolder tasks have nothing to do with approvals, so finding no
    // request is the common case rather than a problem.
    findRequestByTaskId.mockResolvedValue(undefined);

    await onEvent({
      topic: SCAFFOLDER_TASK_TOPIC,
      eventPayload: { id: 'someone-elses-task', status: 'completed' },
    });

    expect(applyTaskStatus).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('ignores a payload it cannot read, without touching the store', async () => {
    await onEvent({
      topic: SCAFFOLDER_TASK_TOPIC,
      eventPayload: { unexpected: 'shape' },
    });

    expect(findRequestByTaskId).not.toHaveBeenCalled();
  });

  it('never throws out of the handler', async () => {
    // The sweep will catch up regardless; an event handler that throws helps
    // nobody and may take the subscription down with it.
    applyTaskStatus.mockRejectedValue(new Error('database down'));

    await expect(
      onEvent({
        topic: SCAFFOLDER_TASK_TOPIC,
        eventPayload: { id: 'task-1', status: 'failed' },
      }),
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/Could not apply task/),
      expect.any(Error),
    );
  });
});
