import { Route, Routes, useParams } from 'react-router-dom';
import { requestRouteRef } from '../routes';
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
 * Written once and mounted by both plugin definitions, so the two entrypoints
 * differ in wiring only.
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
      <Route path={requestRouteRef.path} element={<RequestDetailRoute />} />
    </Routes>
  );
}
