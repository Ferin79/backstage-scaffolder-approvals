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
  type ApprovalRequest,
  type ApprovalRequestWithDecisions,
  type DecideApprovalRequestOptions,
  type ListApprovalRequestsOptions,
  type ListApprovalRequestsResponse,
  SCAFFOLDER_APPROVALS_PLUGIN_ID,
  type SubmitApprovalRequestOptions,
  type SubmitApprovalRequestResponse,
} from '@backstage-community/plugin-scaffolder-approvals-common';
import type { DiscoveryApi, FetchApi } from '@backstage/core-plugin-api';
import { ResponseError } from '@backstage/errors';
import type { ApprovalsApi } from './ApprovalsApi';

/**
 * A `ResponseError` whose message is the sentence the backend wrote.
 *
 * `ResponseError.fromResponse` always sets `message` to the status line —
 * "Request failed with 400 Bad Request" — and keeps what the server said in
 * `cause`. Every caller of this client shows `message` to a person, and the
 * backend's refusals are written to be read: which template shape is refused,
 * which parameter is invalid, why a vote does not count. So the message is
 * replaced with the server's, and everything else the error carries — status,
 * body, cause — stays as it was, which is what `ResponseErrorPanel` reads.
 *
 * Only a Backstage JSON error body is trusted to be readable. Anything else —
 * a proxy's HTML error page, say — keeps the status line rather than putting
 * a page of markup in a toast.
 */
async function toReadableError(response: Response): Promise<ResponseError> {
  const error = await ResponseError.fromResponse(response);
  const isBackstageError = response.headers
    .get('content-type')
    ?.startsWith('application/json');
  if (isBackstageError && error.cause.message) {
    error.message = error.cause.message;
  }
  return error;
}

/** @public */
export class ApprovalsClient implements ApprovalsApi {
  private readonly discoveryApi: DiscoveryApi;
  private readonly fetchApi: FetchApi;

  constructor(options: { discoveryApi: DiscoveryApi; fetchApi: FetchApi }) {
    this.discoveryApi = options.discoveryApi;
    this.fetchApi = options.fetchApi;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const baseUrl = await this.discoveryApi.getBaseUrl(
      SCAFFOLDER_APPROVALS_PLUGIN_ID,
    );
    const response = await this.fetchApi.fetch(`${baseUrl}${path}`, init);

    if (!response.ok) {
      throw await toReadableError(response);
    }

    return (await response.json()) as T;
  }

  private async send<T>(path: string, body?: unknown): Promise<T> {
    return await this.request<T>(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
  }

  async listRequests(
    options: ListApprovalRequestsOptions = {},
  ): Promise<ListApprovalRequestsResponse> {
    const params = new URLSearchParams();

    for (const status of [options.status ?? []].flat()) {
      params.append('status', status);
    }
    if (options.role) {
      params.set('role', options.role);
    }
    if (options.actionable) {
      params.set('actionable', 'true');
    }
    if (options.templateRef) {
      params.set('templateRef', options.templateRef);
    }
    if (options.requesterRef) {
      params.set('requesterRef', options.requesterRef);
    }
    if (options.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options.offset !== undefined) {
      params.set('offset', String(options.offset));
    }

    const query = params.toString();
    return await this.request(`/requests${query ? `?${query}` : ''}`);
  }

  async getRequest(id: string): Promise<ApprovalRequestWithDecisions> {
    return await this.request(`/requests/${encodeURIComponent(id)}`);
  }

  async submitRequest(
    options: SubmitApprovalRequestOptions,
  ): Promise<SubmitApprovalRequestResponse> {
    return await this.send('/requests', options);
  }

  async decide(
    id: string,
    options: DecideApprovalRequestOptions,
  ): Promise<ApprovalRequestWithDecisions> {
    return await this.send(
      `/requests/${encodeURIComponent(id)}/decision`,
      options,
    );
  }

  async cancel(id: string): Promise<ApprovalRequest> {
    return await this.send(`/requests/${encodeURIComponent(id)}/cancel`);
  }
}
