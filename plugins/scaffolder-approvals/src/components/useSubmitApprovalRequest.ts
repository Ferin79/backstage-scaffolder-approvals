import type { SubmitApprovalRequestOptions } from '@ferin79/backstage-plugin-scaffolder-approvals-common';
import { useApi, useRouteRef } from '@backstage/core-plugin-api';
import { toastApiRef } from '@backstage/frontend-plugin-api';
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { approvalsApiRef } from '../api';
import { requestRouteRef } from '../routes';
import { TRANSIENT_TOAST_MS } from './toast';

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
  const toastApi = useApi(toastApiRef);
  const navigate = useNavigate();
  const requestRoute = useRouteRef(requestRouteRef);

  return useCallback(
    async (request, submitted) => {
      const created = await approvalsApi.submitRequest(request);
      toastApi.post({
        title: created.collapsed
          ? 'You already have an identical request open'
          : submitted,
        status: 'success',
        timeout: TRANSIENT_TOAST_MS,
      });
      navigate(requestRoute({ requestId: created.id }));
    },
    [toastApi, approvalsApi, navigate, requestRoute],
  );
}
