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

import { Route, Routes, useParams } from 'react-router-dom';
import { YOUR_REQUESTS_PATH } from './ApprovalsLayout';
import { ApprovalsPage } from './ApprovalsPage';
import { RequestDetail } from './RequestDetail';

function RequestDetailRoute() {
  const { requestId } = useParams();
  return <RequestDetail requestId={requestId!} />;
}

/**
 * Routes for the approvals plugin.
 *
 * Written once and mounted by both plugin definitions, so the dual-ship
 * duplication is wiring only (Q23).
 *
 * @public
 */
export function Router() {
  return (
    <Routes>
      <Route path="/" element={<ApprovalsPage view="inbox" />} />
      <Route
        path={YOUR_REQUESTS_PATH}
        element={<ApprovalsPage view="mine" />}
      />
      <Route path="/requests/:requestId" element={<RequestDetailRoute />} />
    </Routes>
  );
}
