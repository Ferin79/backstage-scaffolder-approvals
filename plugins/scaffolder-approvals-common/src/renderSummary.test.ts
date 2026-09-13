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

import { renderGateSummary } from './renderSummary';

describe('renderGateSummary', () => {
  it('fills parameter references, which is the whole reason it exists', () => {
    // Found by running a real backend: without this an approver reads the
    // literal expression, because the scaffolder's templating has not run when
    // the approvals backend reads the gate step out of the catalog.
    expect(
      renderGateSummary('Admin on ${{ parameters.repository }}', {
        repository: 'backstage',
      }),
    ).toBe('Admin on backstage');
  });

  it('tolerates the spacing a template author might use', () => {
    for (const expression of [
      '${{parameters.repository}}',
      '${{ parameters.repository }}',
      '${{   parameters.repository   }}',
    ]) {
      expect(renderGateSummary(expression, { repository: 'backstage' })).toBe(
        'backstage',
      );
    }
  });

  it('fills several references in one summary', () => {
    expect(
      renderGateSummary(
        '${{ parameters.level }} on ${{ parameters.repository }} for ${{ parameters.days }} days',
        { level: 'admin', repository: 'backstage', days: 7 },
      ),
    ).toBe('admin on backstage for 7 days');
  });

  it('reaches into nested parameters', () => {
    expect(
      renderGateSummary('Access to ${{ parameters.target.repository }}', {
        target: { repository: 'backstage' },
      }),
    ).toBe('Access to backstage');
  });

  it('renders numbers and booleans as they read', () => {
    expect(
      renderGateSummary('${{ parameters.count }} / ${{ parameters.urgent }}', {
        count: 0,
        urgent: false,
      }),
    ).toBe('0 / false');
  });

  it('leaves an unresolvable reference exactly as written', () => {
    // A silent blank would leave the author wondering; showing what they typed
    // points straight at the mistake.
    expect(
      renderGateSummary('Admin on ${{ parameters.missing }}', {
        repository: 'backstage',
      }),
    ).toBe('Admin on ${{ parameters.missing }}');

    expect(
      renderGateSummary('${{ parameters.a.b.c }}', { a: 'not an object' }),
    ).toBe('${{ parameters.a.b.c }}');
  });

  it('leaves an object or array alone rather than dumping JSON into a label', () => {
    expect(
      renderGateSummary('For ${{ parameters.repos }}', {
        repos: ['a', 'b'],
      }),
    ).toBe('For ${{ parameters.repos }}');
  });

  it('does not try to be a templating engine', () => {
    // Anything beyond `parameters.<path>` is left untouched on purpose: running
    // a real engine over catalog text with user values is a far larger surface
    // than a one-line label warrants, and half an engine invites people to
    // expect the other half.
    for (const expression of [
      '${{ parameters.name | upper }}',
      '${{ user.entity.metadata.name }}',
      '${{ steps.gate.output.requestId }}',
      '{{ parameters.repository }}',
    ]) {
      expect(renderGateSummary(expression, { repository: 'backstage' })).toBe(
        expression,
      );
    }
  });

  it('leaves a summary with no references alone', () => {
    expect(renderGateSummary('Production access', {})).toBe(
      'Production access',
    );
  });
});
