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
} from '@ferin79/backstage-plugin-scaffolder-approvals-common';
import { alertApiRef } from '@backstage/core-plugin-api';
import { catalogApiRef, entityRouteRef } from '@backstage/plugin-catalog-react';
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
      mountedRoutes: {
        '/approvals': rootRouteRef,
        // The approvers link to their catalog pages.
        '/catalog/:namespace/:kind/:name': entityRouteRef,
      },
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

    // One sentence, the same the request page uses afterwards. It used to be
    // "2 of these must approve" above a list, which with a single group read
    // as if two groups were expected (B18).
    expect(
      await screen.findByText(/^Needs 2 approvals from/),
    ).toHaveTextContent(
      'Needs 2 approvals from devx-team or lead. The requester cannot approve their own request.',
    );
    expect(screen.queryByText(/of these must approve/)).not.toBeInTheDocument();
  });

  it('links each approver to their catalog page, in a new tab', async () => {
    // B16: by name, not as a raw ref, and somewhere to find out who is in the
    // group. A new tab, because leaving the wizard throws away the form.
    await render({ entity: template(true) });

    const group = await screen.findByRole('link', { name: 'devx-team' });
    expect(group).toHaveAttribute('href', '/catalog/default/group/devx-team');
    expect(group).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('link', { name: 'lead' })).toHaveAttribute(
      'href',
      '/catalog/default/user/lead',
    );
  });

  it('says how many approvals one approver must give', async () => {
    const entity = template(true);
    entity.spec.steps[0].input = {
      approvers: ['group:default/devx-team'],
      quorum: 1,
    } as (typeof entity.spec.steps)[0]['input'];
    await render({ entity });

    expect(
      await screen.findByText(/^Needs one approval from/),
    ).toHaveTextContent('Needs one approval from devx-team.');
  });

  it('shows the values being submitted, as the ordinary review step does', async () => {
    // B7: replacing the review step had dropped its table, so a requester
    // submitted values they could no longer see — the very values the
    // approvers judge and the approval is bound to.
    await render({ entity: template(true) });

    await screen.findByTestId('request-approval');
    expect(screen.getByText('backstage')).toBeInTheDocument();
    expect(screen.getByText('on-call')).toBeInTheDocument();
  });

  describe('a template the backend would refuse', () => {
    // B8: the button was offered, and only the backend said no.
    it('says it cannot be requested, why, and offers only Back', async () => {
      const entity = template(true);
      (entity.spec.steps[0] as Record<string, unknown>).if =
        '${{ parameters.go }}';
      const submitRequest = jest.fn();
      await render({ entity, api: { submitRequest } });

      expect(
        await screen.findByText('This template cannot be requested yet'),
      ).toBeInTheDocument();
      // The backend's own sentence, from the same function it refuses with.
      expect(
        screen.getByText(
          /request-github-admin has an unusable gate: 'approval:gate' must not carry an 'if:' condition/,
        ),
      ).toBeInTheDocument();
      expect(screen.queryByTestId('request-approval')).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Back' }));
      expect(REVIEW_PROPS.handleBack).toHaveBeenCalled();
      expect(submitRequest).not.toHaveBeenCalled();
    });

    it('refuses a secret-typed parameter before the click', async () => {
      const entity = {
        ...template(true),
        spec: {
          ...template(true).spec,
          parameters: {
            properties: { token: { type: 'string', 'ui:field': 'Secret' } },
          },
        },
      };
      await render({ entity });

      expect(
        await screen.findByText(/its parameter\(s\) token are secret-typed/),
      ).toBeInTheDocument();
      expect(screen.queryByTestId('request-approval')).not.toBeInTheDocument();
    });
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
