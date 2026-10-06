import { APPROVALS_SIGNAL_CHANNEL } from '@ferin79/backstage-plugin-scaffolder-approvals-common';
import { useSignal } from '@backstage/plugin-signals-react';
import { useEffect, useRef } from 'react';

/**
 * Call `onChange` whenever the backend says an approval request changed — any
 * request, or only the one whose id is given.
 *
 * The backend broadcasts `{ action, requestId, status }` on every change: a
 * vote, a launch, a task finishing, a sweep expiring something. The page
 * refetches rather than trusting the signal's own status, so a signal is only
 * ever a prompt to look.
 *
 * Signals are a soft dependency: without the signals plugin, `useSignal`
 * subscribes to nothing, and a page still refreshes on its own actions.
 */
export function useOnApprovalsChange(
  onChange: () => void,
  requestId?: string,
): void {
  const { lastSignal } = useSignal(APPROVALS_SIGNAL_CHANNEL);

  // The latest callback, so a caller passing an inline function does not
  // resubscribe or refire on every render.
  const callback = useRef(onChange);
  callback.current = onChange;

  useEffect(() => {
    if (!lastSignal) {
      return;
    }
    if (requestId !== undefined && lastSignal.requestId !== requestId) {
      return;
    }
    callback.current();
  }, [lastSignal, requestId]);
}
