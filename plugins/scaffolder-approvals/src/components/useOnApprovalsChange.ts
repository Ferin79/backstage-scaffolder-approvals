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

import { APPROVALS_SIGNAL_CHANNEL } from '@ferin79/backstage-plugin-scaffolder-approvals-common';
import { useSignal } from '@backstage/plugin-signals-react';
import { useEffect, useRef } from 'react';

/**
 * Call `onChange` whenever the backend says an approval request changed — any
 * request, or only the one whose id is given.
 *
 * The backend broadcasts `{ action, requestId, status }` on every change: a
 * vote, a launch, a task finishing, a sweep expiring something. Without this, a
 * page showed somebody else's decision, or a template finishing, only once it
 * was reloaded (B10 in the browser review). The page refetches rather than
 * trusting the signal's own status, so a signal is only ever a prompt to look.
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
