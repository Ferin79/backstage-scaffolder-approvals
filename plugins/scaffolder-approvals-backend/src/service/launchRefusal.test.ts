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

import { describeLaunchRefusal } from './launchRefusal';

/** What `ScaffolderClient.scaffold` throws for an answer other than 201. */
function clientFailure(status: string, body: unknown): Error {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new Error(`Backend request failed, ${status} ${text}`);
}

/** The scaffolder's answer when the values no longer fit the parameters. */
const INVALID_PARAMETERS = {
  errors: [
    {
      path: [],
      property: 'instance',
      message: 'requires property "ticket"',
      schema: { required: ['repository', 'ticket'] },
      instance: { repository: 'acme/secret-repo' },
      name: 'required',
      argument: 'ticket',
      stack: 'instance requires property "ticket"',
    },
    {
      path: ['oncall'],
      property: 'instance.oncall',
      message: 'requires property "primaryContact"',
      instance: {},
    },
  ],
};

describe('describeLaunchRefusal', () => {
  it('names what the scaffolder refused, field by field', () => {
    expect(
      describeLaunchRefusal(
        clientFailure('400 Bad Request', INVALID_PARAMETERS),
      ),
    ).toBe(
      'the scaffolder refused to start the template (400 Bad Request): requires property "ticket"; oncall requires property "primaryContact"',
    );
  });

  it('never repeats the submitted values or the schema from the body', () => {
    const reason = describeLaunchRefusal(
      clientFailure('400 Bad Request', INVALID_PARAMETERS),
    );
    expect(reason).not.toContain('acme/secret-repo');
    expect(reason).not.toContain('required');
  });

  it('reads a Backstage error body', () => {
    expect(
      describeLaunchRefusal(
        clientFailure('404 Not Found', {
          error: {
            name: 'NotFoundError',
            message: 'Template template:default/gone not found',
          },
        }),
      ),
    ).toBe(
      'the scaffolder refused to start the template (404 Not Found): Template template:default/gone not found',
    );
  });

  it('falls back to the status when the body says nothing usable', () => {
    expect(describeLaunchRefusal(clientFailure('403 Forbidden', ''))).toBe(
      'the scaffolder refused to start the template (403 Forbidden)',
    );
    expect(
      describeLaunchRefusal(
        clientFailure('422 Unprocessable Entity', '<html>gateway</html>'),
      ),
    ).toBe(
      'the scaffolder refused to start the template (422 Unprocessable Entity)',
    );
  });

  it('reads a client that throws a ResponseError-like error', () => {
    const error = Object.assign(new Error('Request failed'), {
      statusCode: 400,
      body: INVALID_PARAMETERS,
    });
    expect(describeLaunchRefusal(error)).toMatch(
      /^the scaffolder refused to start the template \(400 Bad Request\): requires property "ticket"/,
    );
  });

  // Q9: these say nothing about whether a task exists, so the launch must be
  // retried rather than failed.
  it.each([
    ['a 500', clientFailure('500 Internal Server Error', {})],
    ['a 503', clientFailure('503 Service Unavailable', '')],
    ['a 401', clientFailure('401 Unauthorized', {})],
    ['a connection failure', new TypeError('fetch failed')],
    ['a timeout', new Error('The operation was aborted due to timeout')],
    ['something that is not an error', 'oops'],
  ])('leaves %s to the retry', (_, error) => {
    expect(describeLaunchRefusal(error)).toBeUndefined();
  });

  it('keeps a very long reason to one readable sentence', () => {
    const reason = describeLaunchRefusal(
      clientFailure('400 Bad Request', {
        error: { message: 'x'.repeat(2000) },
      }),
    );
    expect(reason!.length).toBeLessThanOrEqual(500);
    expect(reason!.endsWith('…')).toBe(true);
  });
});
