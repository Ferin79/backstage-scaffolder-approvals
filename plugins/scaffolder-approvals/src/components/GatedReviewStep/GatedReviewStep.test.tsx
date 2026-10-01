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
  GATE_ACTION_ID,
  GATED_ANNOTATION,
} from '@backstage-community/plugin-scaffolder-approvals-common';
import { alertApiRef } from '@backstage/core-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { type ApprovalsApi, approvalsApiRef } from '../../api';
import { rootRouteRef } from '../../routes';
import { GatedReviewStep } from './GatedReviewStep';

const TEMPLATE_REF = 'template:default/request-github-admin';
const VALUES = { repository: 'backstage', justification: 'on-call' };

function template(gated: boolean) {
  return {
    apiVersion: 'scaffolder.backstage.io/v1beta3',
    kind: 'Template',
    metadata: {
      name: 'request-github-admin',
      namespace: 'default',
      ...(gated ? { annotations: { [GATED_ANNOTATION]: 'true' } } : {}),
    },
    spec: {
      type: 'service',
      steps: [
        {
          id: 'gate',
          action: GATE_ACTION_ID,
          input: {
            approvers: ['group:default/devx-team', 'user:default/lead'],
            quorum: 2,
          },
        },
      ],
    },
  };
}

const REVIEW_PROPS = {
  disableButtons: false,
  formData: VALUES,
  handleBack: jest.fn(),
  handleReset: jest.fn(),
  handleCreate: jest.fn(),
  steps: [],
};

function render(options: {
  entity?: unknown;
  api?: Partial<ApprovalsApi>;
  alertApi?: { post: jest.Mock; alert$: jest.Mock };
  catalogApi?: { getEntityByRef: jest.Mock };
  // The scaffolder's own wizard routes. Mounting a made-up shape here once hid
  // that the component never recognised a gated template in a real app.
  path?: string;
  entry?: string;
}) {
  const catalogApi = options.catalogApi ?? {
    getEntityByRef: jest.fn(async () => options.entity),
  };

  return renderInTestApp(
    <TestApiProvider
      apis={[
        [catalogApiRef, catalogApi as any],
        [approvalsApiRef, (options.api ?? {}) as ApprovalsApi],
        [
          alertApiRef,
          (options.alertApi ?? { post: jest.fn(), alert$: jest.fn() }) as any,
        ],
      ]}
    >
      <Routes>
        <Route
          path={options.path ?? '/create/templates/:namespace/:templateName'}
          element={
            <GatedReviewStep {...REVIEW_PROPS}>
              <div>default review step</div>
            </GatedReviewStep>
          }
        />
      </Routes>
    </TestApiProvider>,
    {
      mountedRoutes: { '/approvals': rootRouteRef },
      routeEntries: [
        options.entry ?? '/create/templates/default/request-github-admin',
      ],
    },
  );
}

describe('GatedReviewStep', () => {
  afterEach(() => jest.resetAllMocks());

  it('asks for approval instead of running a gated template', async () => {
    // G1: without this the requester meets the gate as a failed task, with a
    // message pointing at a page that had no way to create a request.
    const submitRequest = jest
      .fn()
      .mockResolvedValue({ id: 'req-1', collapsed: false });

    await render({ entity: template(true), api: { submitRequest } });

    await userEvent.click(await screen.findByTestId('request-approval'));

    expect(submitRequest).toHaveBeenCalledWith({
      templateRef: TEMPLATE_REF,
      values: VALUES,
    });
    // Never the scaffolder's own create: the gate would throw on step one.
    expect(REVIEW_PROPS.handleCreate).not.toHaveBeenCalled();
  });

  it("reads the template from the scaffolder's wizard routes", async () => {
    // `/templates/:namespace/:templateName` is the route the scaffolder mounts
    // the wizard on; the older `/templates/:templateName` means the default
    // namespace. Neither carries a kind.
    for (const [path, entry] of [
      [
        '/create/templates/:namespace/:templateName',
        '/create/templates/default/request-github-admin',
      ],
      [
        '/create/templates/:templateName',
        '/create/templates/request-github-admin',
      ],
    ]) {
      const catalogApi = {
        getEntityByRef: jest.fn(async () => template(true)),
      };
      const { unmount } = await render({ catalogApi, path, entry });

      expect(await screen.findByTestId('request-approval')).toBeInTheDocument();
      expect(catalogApi.getEntityByRef).toHaveBeenCalledWith(TEMPLATE_REF);
      unmount();
    }
  });

  it('shows who will be asked, and how many of them', async () => {
    await render({ entity: template(true) });

    expect(
      await screen.findByText('2 of these must approve'),
    ).toBeInTheDocument();
    expect(screen.getByText('group:default/devx-team')).toBeInTheDocument();
    expect(screen.getByText('user:default/lead')).toBeInTheDocument();
  });

  it('renders the ordinary review step for an ungated template', async () => {
    await render({ entity: template(false) });

    expect(await screen.findByText('default review step')).toBeInTheDocument();
    expect(screen.queryByTestId('request-approval')).not.toBeInTheDocument();
  });

  it('falls back to the ordinary review step when the catalog says nothing', async () => {
    // Failing open costs nothing here: the gate is what enforces anything, so
    // the worst case is the requester meeting it as a failed task, which is
    // where they were before this component existed.
    await render({ entity: undefined });

    expect(await screen.findByText('default review step')).toBeInTheDocument();
  });

  it('says what the backend said when a request is refused', async () => {
    // The backend validates the values against the template's own parameter
    // schema and refuses in words worth reading.
    const alertApi = { post: jest.fn(), alert$: jest.fn() };
    await render({
      entity: template(true),
      api: {
        submitRequest: jest
          .fn()
          .mockRejectedValue(
            new Error("values do not match the template's parameters"),
          ),
      },
      alertApi,
    });

    await userEvent.click(await screen.findByTestId('request-approval'));

    expect(alertApi.post).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('do not match'),
        severity: 'error',
      }),
    );
  });

  it('says so when an identical request is already open', async () => {
    const alertApi = { post: jest.fn(), alert$: jest.fn() };
    await render({
      entity: template(true),
      api: {
        submitRequest: jest
          .fn()
          .mockResolvedValue({ id: 'req-1', collapsed: true }),
      },
      alertApi,
    });

    await userEvent.click(await screen.findByTestId('request-approval'));

    expect(alertApi.post).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'You already have an identical request open',
      }),
    );
  });
});
