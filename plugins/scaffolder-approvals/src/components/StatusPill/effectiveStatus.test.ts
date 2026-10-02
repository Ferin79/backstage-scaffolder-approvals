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

import { effectiveStatus } from './effectiveStatus';

const NOW = new Date('2026-10-02T12:00:00.000Z');

describe('effectiveStatus', () => {
  it('shows a pending request past its deadline as expired', () => {
    expect(
      effectiveStatus(
        { status: 'pending', expiresAt: '2026-10-02T11:59:59.000Z' },
        NOW,
      ),
    ).toBe('expired');
  });

  it('treats the deadline itself as passed, as the backend does', () => {
    // `checkDecisionEligibility` refuses at `expiresAt <= now`.
    expect(
      effectiveStatus({ status: 'pending', expiresAt: NOW.toISOString() }, NOW),
    ).toBe('expired');
  });

  it('leaves a pending request with time left, or no deadline, as pending', () => {
    expect(
      effectiveStatus(
        { status: 'pending', expiresAt: '2026-10-02T12:00:01.000Z' },
        NOW,
      ),
    ).toBe('pending');
    expect(effectiveStatus({ status: 'pending' }, NOW)).toBe('pending');
  });

  it('never changes a settled status', () => {
    // A completed request had a deadline once; it no longer matters.
    expect(
      effectiveStatus(
        { status: 'completed', expiresAt: '2020-01-01T00:00:00.000Z' },
        NOW,
      ),
    ).toBe('completed');
  });
});
