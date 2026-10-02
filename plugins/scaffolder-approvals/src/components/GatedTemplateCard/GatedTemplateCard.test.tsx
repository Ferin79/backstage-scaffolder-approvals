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
import {
  entityPresentationApiRef,
  entityRouteRef,
  MockStarredEntitiesApi,
  starredEntitiesApiRef,
} from '@backstage/plugin-catalog-react';
import type { TemplateEntityV1beta3 } from '@backstage/plugin-scaffolder-common';
import type { JsonObject } from '@backstage/types';
import { permissionApiRef } from '@backstage/plugin-permission-react';
import {
  mockApis,
  renderInTestApp,
  TestApiProvider,
} from '@backstage/test-utils';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { rootRouteRef } from '../../routes';
import { GatedTemplateCard } from './GatedTemplateCard';

function template(
  options: { gated?: boolean; gate?: JsonObject } = {},
): TemplateEntityV1beta3 {
  return {
    apiVersion: 'scaffolder.backstage.io/v1beta3',
    kind: 'Template',
    metadata: {
      name: 'request-github-admin',
      namespace: 'default',
      title: 'Request GitHub admin access',
      ...(options.gated === false
        ? {}
        : { annotations: { [GATED_ANNOTATION]: 'true' } }),
    },
    spec: {
      type: 'service',
      steps: [
        {
          id: 'gate',
          action: GATE_ACTION_ID,
          input: options.gate ?? {
            approvers: ['group:default/devx-team', 'user:default/lead'],
            quorum: 2,
          },
        },
      ],
    },
  };
}

/** The catalog's presentation API, answering from a fixed list of titles. */
function fakePresentation(titles: Record<string, string>) {
  return {
    forEntity(entityRef: string) {
      const snapshot = {
        entityRef,
        primaryTitle: titles[entityRef] ?? entityRef,
      };
      return { snapshot, promise: Promise.resolve(snapshot) };
    },
  };
}

function render(
  props: Parameters<typeof GatedTemplateCard>[0],
  options: { presentation?: ReturnType<typeof fakePresentation> } = {},
) {
  return renderInTestApp(
    <TestApiProvider
      apis={[
        // The scaffolder's card offers Choose only to those allowed to run it.
        [permissionApiRef, mockApis.permission()],
        // And a star for favourites.
        [starredEntitiesApiRef, new MockStarredEntitiesApi()],
        ...(options.presentation
          ? [[entityPresentationApiRef, options.presentation] as const]
          : []),
      ]}
    >
      <GatedTemplateCard {...props} />
    </TestApiProvider>,
    {
      mountedRoutes: {
        '/scaffolder-approvals': rootRouteRef,
        '/catalog/:namespace/:kind/:name': entityRouteRef,
      },
    },
  );
}

/** The card's links, as text and destination. */
function cardLinks() {
  return screen
    .getAllByRole('link')
    .map(link => [link.textContent, link.getAttribute('href')]);
}

describe('GatedTemplateCard', () => {
  it('names the approvers of a gated template, each linked to their page', async () => {
    // B17: on Create…, nothing told a gated template from any other, and a
    // requester found out on the wizard's last step.
    await render(
      { template: template() },
      {
        presentation: fakePresentation({
          'group:default/devx-team': 'DevX team',
          'user:default/lead': 'Lee Lead',
        }),
      },
    );

    expect(
      await screen.findByText('Request GitHub admin access'),
    ).toBeInTheDocument();
    expect(await screen.findByText('Approver: DevX team')).toBeInTheDocument();
    expect(cardLinks()).toEqual(
      expect.arrayContaining([
        ['Approver: DevX team', '/catalog/default/group/devx-team'],
        ['Approver: Lee Lead', '/catalog/default/user/lead'],
      ]),
    );
  });

  it('falls back to the names in the refs without the presentation API', async () => {
    await render({ template: template() });

    expect(await screen.findByText('Approver: devx-team')).toBeInTheDocument();
    expect(screen.getByText('Approver: lead')).toBeInTheDocument();
  });

  it('adds nothing to a template that is not gated', async () => {
    await render({ template: template({ gated: false }) });

    expect(
      await screen.findByText('Request GitHub admin access'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Approver:|Needs approval/),
    ).not.toBeInTheDocument();
  });

  it('still says a template needs approval when its gate cannot be read', async () => {
    // The review step explains what is wrong; the card only must not suggest
    // the template runs straight away.
    await render({ template: template({ gate: { quorum: 1 } }) });

    expect(await screen.findByText('Needs approval')).toBeInTheDocument();
    expect(cardLinks()).toEqual(
      expect.arrayContaining([['Needs approval', '/scaffolder-approvals']]),
    );
  });

  it("keeps the app's own links, after the approvers", async () => {
    await render({
      template: template(),
      additionalLinks: [
        { icon: () => null, text: 'View TechDocs', url: '/docs/x' },
      ],
    });

    await screen.findByText('View TechDocs');
    const texts = cardLinks().map(([text]) => text);
    expect(texts.indexOf('Approver: devx-team')).toBeLessThan(
      texts.indexOf('View TechDocs'),
    );
  });

  it('hands the template to the page when chosen', async () => {
    // The page gives a replacement card a callback that takes the template;
    // the scaffolder's own card calls its callback with nothing.
    const onSelected = jest.fn();
    const entity = template();
    await render({ template: entity, onSelected });

    await userEvent.click(
      await screen.findByRole('button', { name: 'Choose' }),
    );

    expect(onSelected).toHaveBeenCalledWith(entity);
  });
});
