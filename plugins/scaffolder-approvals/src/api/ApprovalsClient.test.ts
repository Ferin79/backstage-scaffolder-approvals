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

import type { DiscoveryApi, FetchApi } from '@backstage/core-plugin-api';
import { ApprovalsClient } from './ApprovalsClient';

const BASE_URL = 'http://localhost:7007/api/scaffolder-approvals';

/**
 * The parts of a fetch `Response` the client and `ResponseError` read. Built by
 * hand because jsdom has no `Response`, and a hand-built one also keeps the
 * content type explicit, which is what decides whether a body is trusted.
 */
function fakeResponse(options: {
  status: number;
  statusText: string;
  contentType: string;
  body: string;
}): Response {
  return {
    ok: options.status >= 200 && options.status < 300,
    status: options.status,
    statusText: options.statusText,
    url: `${BASE_URL}/requests`,
    type: 'basic',
    redirected: false,
    headers: {
      get: (name: string) =>
        name.toLocaleLowerCase('en-US') === 'content-type'
          ? options.contentType
          : null,
    },
    text: async () => options.body,
    json: async () => JSON.parse(options.body),
  } as unknown as Response;
}

/** The body Backstage's error middleware sends for a thrown `InputError`. */
function backstageError(statusCode: number, name: string, message: string) {
  return JSON.stringify({
    error: { name, message, stack: `${name}: ${message}\n    at somewhere` },
    request: { method: 'POST', url: '/requests' },
    response: { statusCode },
  });
}

function clientAnswering(response: Response) {
  const discoveryApi: DiscoveryApi = {
    getBaseUrl: async () => BASE_URL,
  };
  const fetch = jest.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) => response,
  );
  const fetchApi: FetchApi = { fetch };
  return { client: new ApprovalsClient({ discoveryApi, fetchApi }), fetch };
}

describe('ApprovalsClient', () => {
  describe('when the backend refuses', () => {
    // B1 in the browser review: every refusal reached people as "Request failed
    // with 400 Bad Request", because ResponseError puts the status line in
    // `message` and the component tests mock this client with plain Errors.
    it('makes the sentence the backend wrote the error message', async () => {
      const refusal =
        "template:default/probe-if-gate has an unusable gate: 'approval:gate' must not carry an 'if:' condition";
      const { client } = clientAnswering(
        fakeResponse({
          status: 400,
          statusText: 'Bad Request',
          contentType: 'application/json; charset=utf-8',
          body: backstageError(400, 'InputError', refusal),
        }),
      );

      await expect(
        client.submitRequest({
          templateRef: 'template:default/probe-if-gate',
          values: {},
        }),
      ).rejects.toMatchObject({ message: refusal });
    });

    it('keeps everything else a ResponseError carries', async () => {
      // `ResponseErrorPanel` renders the status, the name and the body from
      // these, so replacing the message must not cost them.
      const { client } = clientAnswering(
        fakeResponse({
          status: 409,
          statusText: 'Conflict',
          contentType: 'application/json',
          body: backstageError(
            409,
            'ConflictError',
            'You have already decided on this request',
          ),
        }),
      );

      const error = await client
        .decide('3f1e4c8a-0000-4000-8000-000000000001', {
          decision: 'approve',
        })
        .catch(e => e);

      expect(error.name).toBe('ResponseError');
      expect(error.statusCode).toBe(409);
      expect(error.cause.name).toBe('ConflictError');
      expect(error.body.error.message).toBe(
        'You have already decided on this request',
      );
      expect(error.message).toBe('You have already decided on this request');
    });

    it('never shows a stack trace', async () => {
      const { client } = clientAnswering(
        fakeResponse({
          status: 404,
          statusText: 'Not Found',
          contentType: 'application/json',
          body: backstageError(
            404,
            'NotFoundError',
            'No such approval request',
          ),
        }),
      );

      const error = await client
        .getRequest('3f1e4c8a-0000-4000-8000-000000000002')
        .catch(e => e);

      expect(error.message).toBe('No such approval request');
      expect(error.message).not.toMatch(/at somewhere/);
    });

    it('keeps the status line for a body that is not a Backstage error', async () => {
      // A proxy's HTML error page is not a sentence anyone should see in a
      // toast; the status line is the better message there.
      const { client } = clientAnswering(
        fakeResponse({
          status: 502,
          statusText: 'Bad Gateway',
          contentType: 'text/html',
          body: '<html><body><h1>502 Bad Gateway</h1></body></html>',
        }),
      );

      const error = await client.listRequests().catch(e => e);

      expect(error.message).toBe('Request failed with 502 Bad Gateway');
    });
  });

  describe('listRequests', () => {
    it('asks for only what the caller can act on when told to', async () => {
      const { client, fetch } = clientAnswering(
        fakeResponse({
          status: 200,
          statusText: 'OK',
          contentType: 'application/json',
          body: JSON.stringify({ items: [], totalItems: 0 }),
        }),
      );

      await client.listRequests({
        role: 'approver',
        actionable: true,
        limit: 1,
      });

      const url = new URL(fetch.mock.calls[0][0] as string);
      expect(url.searchParams.get('role')).toBe('approver');
      expect(url.searchParams.get('actionable')).toBe('true');
      expect(url.searchParams.get('limit')).toBe('1');
    });

    it('leaves the parameter out when it is not asked for', async () => {
      const { client, fetch } = clientAnswering(
        fakeResponse({
          status: 200,
          statusText: 'OK',
          contentType: 'application/json',
          body: JSON.stringify({ items: [], totalItems: 0 }),
        }),
      );

      await client.listRequests({ role: 'approver' });

      const url = new URL(fetch.mock.calls[0][0] as string);
      expect(url.searchParams.has('actionable')).toBe(false);
    });
  });
});
