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
  rowToApprovalDecision,
  rowToApprovalRequest,
  timestampToIso,
} from './rowMapping';
import type { ApprovalRequestRow } from './tables';

const ROW: ApprovalRequestRow = {
  id: '3f1e4c8a-0000-4000-8000-000000000001',
  template_ref: 'template:default/gated',
  values_json: '{"repository":"backstage"}',
  values_hash: 'a'.repeat(64),
  requester_ref: 'user:default/requester',
  status: 'pending',
  summary: 'Admin on backstage',
  policy_snapshot: '{"approvers":["group:default/devx"],"quorum":1}',
  task_id: null,
  launch_attempt: 0,
  launch_attempted_at: null,
  created_at: new Date('2026-09-12T10:00:00.000Z'),
  updated_at: new Date('2026-09-12T10:00:00.000Z'),
  expires_at: null,
  decided_at: null,
  redacted_at: null,
};

describe('timestampToIso', () => {
  it('normalises every shape a driver hands back', () => {
    const expected = '2026-09-12T10:30:00.000Z';

    // pg and mysql2.
    expect(timestampToIso(new Date(expected), 'created_at')).toBe(expected);
    // better-sqlite3 returns epoch milliseconds.
    expect(timestampToIso(Date.parse(expected), 'created_at')).toBe(expected);
    // An ISO string with a zone.
    expect(timestampToIso(expected, 'created_at')).toBe(expected);
  });

  it('reads a naive datetime string as UTC, not as local time', () => {
    // mysql2 with `dateStrings` returns this shape. Handing it straight to
    // `new Date(...)` reads it in the server's zone, which silently shifts
    // every timestamp by the offset — and expiry comparisons along with it.
    expect(timestampToIso('2026-09-12 10:30:00', 'created_at')).toBe(
      '2026-09-12T10:30:00.000Z',
    );
    expect(timestampToIso('2026-09-12 10:30:00.123', 'created_at')).toBe(
      '2026-09-12T10:30:00.123Z',
    );
    expect(timestampToIso('2026-09-12T10:30:00', 'created_at')).toBe(
      '2026-09-12T10:30:00.000Z',
    );
  });

  it('leaves an explicit offset alone', () => {
    expect(timestampToIso('2026-09-12T12:30:00+02:00', 'created_at')).toBe(
      '2026-09-12T10:30:00.000Z',
    );
  });

  it('refuses what it cannot parse', () => {
    expect(() => timestampToIso('not a date', 'created_at')).toThrow(
      /Unparseable timestamp in created_at/,
    );
    expect(() => timestampToIso({} as unknown as Date, 'created_at')).toThrow(
      /Unexpected timestamp type in created_at/,
    );
  });
});

describe('rowToApprovalRequest', () => {
  it('maps the columns and parses the JSON ones', () => {
    expect(rowToApprovalRequest(ROW)).toEqual({
      id: ROW.id,
      templateRef: 'template:default/gated',
      values: { repository: 'backstage' },
      valuesHash: 'a'.repeat(64),
      requesterRef: 'user:default/requester',
      status: 'pending',
      summary: 'Admin on backstage',
      policySnapshot: { approvers: ['group:default/devx'], quorum: 1 },
      createdAt: '2026-09-12T10:00:00.000Z',
      updatedAt: '2026-09-12T10:00:00.000Z',
    });
  });

  it('omits absent optional fields rather than setting them undefined', () => {
    // So that a round-trip through JSON is a fixed point.
    const mapped = rowToApprovalRequest(ROW);
    expect(Object.keys(mapped)).not.toContain('taskId');
    expect(Object.keys(mapped)).not.toContain('expiresAt');
    expect(mapped).toEqual(JSON.parse(JSON.stringify(mapped)));
  });

  it('carries the optional fields through when present', () => {
    expect(
      rowToApprovalRequest({
        ...ROW,
        task_id: 'task-1',
        expires_at: new Date('2026-09-15T10:00:00.000Z'),
        decided_at: new Date('2026-09-13T10:00:00.000Z'),
        redacted_at: new Date('2027-03-12T10:00:00.000Z'),
      }),
    ).toMatchObject({
      taskId: 'task-1',
      expiresAt: '2026-09-15T10:00:00.000Z',
      decidedAt: '2026-09-13T10:00:00.000Z',
      redactedAt: '2027-03-12T10:00:00.000Z',
    });
  });

  it('represents a redacted request as null values and summary', () => {
    // Redaction is a state every consumer has to handle, not an edge case.
    const mapped = rowToApprovalRequest({
      ...ROW,
      status: 'completed',
      values_json: null,
      summary: null,
      redacted_at: new Date('2027-03-12T10:00:00.000Z'),
    });

    expect(mapped.values).toBeNull();
    expect(mapped.summary).toBeNull();
    // The hash outlives the values, so a grant can still be checked.
    expect(mapped.valuesHash).toBe('a'.repeat(64));
  });

  it('refuses a status it does not recognise', () => {
    // A newer plugin version wrote this row. Guessing would drive the state
    // machine off a state it has no rules for.
    expect(() =>
      rowToApprovalRequest({ ...ROW, status: 'half-approved' }),
    ).toThrow(/Unknown status 'half-approved'/);
  });

  it('refuses malformed JSON instead of returning a partial request', () => {
    expect(() =>
      rowToApprovalRequest({ ...ROW, policy_snapshot: '{not json' }),
    ).toThrow(/Malformed JSON in policy_snapshot/);
    expect(() =>
      rowToApprovalRequest({ ...ROW, values_json: '{not json' }),
    ).toThrow(/Malformed JSON in values_json/);
  });
});

describe('rowToApprovalDecision', () => {
  it('maps a decision and omits an absent comment', () => {
    expect(
      rowToApprovalDecision({
        id: 'd1',
        request_id: ROW.id,
        approver_ref: 'user:default/alice',
        decision: 'approve',
        comment: null,
        created_at: new Date('2026-09-12T10:00:00.000Z'),
      }),
    ).toEqual({
      id: 'd1',
      requestId: ROW.id,
      approverRef: 'user:default/alice',
      decision: 'approve',
      createdAt: '2026-09-12T10:00:00.000Z',
    });
  });

  it('refuses an outcome it does not recognise', () => {
    expect(() =>
      rowToApprovalDecision({
        id: 'd1',
        request_id: ROW.id,
        approver_ref: 'user:default/alice',
        decision: 'abstain',
        comment: null,
        created_at: new Date(),
      }),
    ).toThrow(/Unknown decision 'abstain'/);
  });
});
