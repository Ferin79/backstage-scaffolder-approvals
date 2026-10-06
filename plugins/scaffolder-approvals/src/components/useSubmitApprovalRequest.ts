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

import type { SubmitApprovalRequestOptions } from '@ferin79/backstage-plugin-scaffolder-approvals-common';
import { alertApiRef, useApi, useRouteRef } from '@backstage/core-plugin-api';
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { approvalsApiRef } from '../api';
import { requestRouteRef } from '../routes';

/**
 * Submit an approval request, say so, and open the request it made.
 *
 * Shared by the wizard's review step and Resubmit on a failed request. An
 * identical pending request is reused rather than duplicated, and the alert
 * says that instead of `submitted`. Errors are left to the caller, which knows
 * what to suggest.
 */
export function useSubmitApprovalRequest(): (
  request: SubmitApprovalRequestOptions,
  submitted: string,
) => Promise<void> {
  const approvalsApi = useApi(approvalsApiRef);
  const alertApi = useApi(alertApiRef);
  const navigate = useNavigate();
  const requestRoute = useRouteRef(requestRouteRef);

  return useCallback(
    async (request, submitted) => {
      const created = await approvalsApi.submitRequest(request);
      alertApi.post({
        message: created.collapsed
          ? 'You already have an identical request open'
          : submitted,
        severity: 'success',
        display: 'transient',
      });
      navigate(requestRoute({ requestId: created.id }));
    },
    [alertApi, approvalsApi, navigate, requestRoute],
  );
}
