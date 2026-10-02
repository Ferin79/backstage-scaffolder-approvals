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

import { InfoCard, Progress } from '@backstage/core-components';
import { useApi, useRouteRef } from '@backstage/core-plugin-api';
import { ButtonLink, Flex, Link, Text } from '@backstage/ui';
import { useState } from 'react';
import useAsync from 'react-use/esm/useAsync';
import { approvalsApiRef } from '../../api';
import { rootRouteRef } from '../../routes';
import { useOnApprovalsChange } from '../useOnApprovalsChange';

/**
 * How many requests are waiting on you, on the home page.
 *
 * An approvals inbox is only useful if people know there is something in it.
 * Nothing notifies an approver a second time, so without somewhere ambient to
 * see the count, a request that arrived while somebody was on holiday waits
 * until it expires.
 *
 * Counted with `role=approver`, `actionable` and `status=pending`, which is the
 * same query the inbox tab runs — so the number here and the list there cannot
 * disagree. `actionable` is what lets the number fall when somebody votes: a
 * request they have decided, or their own that they may not approve, is not
 * waiting on them.
 * `limit: 1` because only `totalItems` is wanted; the rows are the page's job.
 *
 * @public
 */
export function PendingApprovalsCard() {
  return (
    <InfoCard title="Approvals" actions={<PendingApprovalsActions />}>
      <PendingApprovalsContent />
    </InfoCard>
  );
}

/**
 * The card's footer: the way to the approvals page, whatever the count, since
 * that is also where somebody's own requests are.
 *
 * In the card's actions rather than as an `InfoCard` deep link, because the
 * home-page extensions draw their own card and take only `Content` and
 * `Actions` from this one. With a deep link, the card on the home page had no
 * way to the page at all (B19 in the browser review). This way the standalone
 * card and both extensions are the same card.
 *
 * @internal
 */
export function PendingApprovalsActions() {
  const rootPath = useRouteRef(rootRouteRef);

  return (
    <ButtonLink href={rootPath()} variant="tertiary">
      Open approvals
    </ButtonLink>
  );
}

/**
 * The card's body, without a card around it.
 *
 * This is what the home-page extensions render. `createCardExtension` and
 * `HomePageWidgetBlueprint` both put their `Content` inside a titled card of
 * their own, so handing them the whole card drew one card inside another.
 *
 * @internal
 */
export function PendingApprovalsContent() {
  const api = useApi(approvalsApiRef);
  const rootPath = useRouteRef(rootRouteRef);

  // Bumped by a signal, so a request arriving — or somebody else deciding the
  // one that was waiting — changes the number without a page reload.
  const [version, setVersion] = useState(0);
  useOnApprovalsChange(() => setVersion(value => value + 1));

  const state = useAsync(
    () =>
      api.listRequests({
        role: 'approver',
        actionable: true,
        status: ['pending'],
        limit: 1,
      }),
    [api, version],
  );

  return (
    <>
      {/* The first load only; a refresh keeps the old number until the new one
          arrives rather than flashing a spinner on the home page. */}
      {state.loading && !state.value && <Progress />}

      {/* A home card that cannot reach its backend says so and stays out of
          the way. Throwing here would take the whole home page with it. */}
      {state.error && (
        <Text>Could not load your approvals: {state.error.message}</Text>
      )}

      {state.value && (
        <Flex direction="column" gap="2">
          <Text variant="title-medium">{state.value.totalItems}</Text>
          {/* `body-large`, the size of the body text in the MUI cards a home
              page puts beside this one (B19). */}
          <Text variant="body-large">
            {state.value.totalItems === 0
              ? 'Nothing is waiting on you.'
              : `${
                  state.value.totalItems === 1 ? 'request is' : 'requests are'
                } waiting on your decision.`}
          </Text>
          {state.value.totalItems > 0 && (
            <Link href={rootPath()}>Review them</Link>
          )}
        </Flex>
      )}
    </>
  );
}
