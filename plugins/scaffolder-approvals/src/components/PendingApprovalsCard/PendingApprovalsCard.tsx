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

import { useApi, useRouteRef } from '@backstage/core-plugin-api';
import {
  Alert,
  ButtonLink,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Flex,
  Link,
  Skeleton,
  Text,
} from '@backstage/ui';
import { RiArrowRightLine } from '@remixicon/react';
import { useState } from 'react';
import useAsync from 'react-use/esm/useAsync';
import { approvalsApiRef } from '../../api';
import { rootRouteRef } from '../../routes';
import { ApprovalsIcon } from '../ApprovalsIcon';
import { INBOX_QUERY } from '../queries';
import { useOnApprovalsChange } from '../useOnApprovalsChange';
import styles from './PendingApprovalsCard.module.css';

/**
 * How many requests are waiting on you, on the home page.
 *
 * An approvals inbox is only useful if people know there is something in it.
 * Nothing notifies an approver a second time, so without somewhere ambient to
 * see the count, a request that arrived while somebody was on holiday waits
 * until it expires.
 *
 * Counted with the same query the inbox tab runs, so the number here and the
 * list there cannot disagree, and the number falls when somebody votes.
 * `limit: 1` because only `totalItems` is wanted; the rows are the page's job.
 *
 * @public
 */
export function PendingApprovalsCard() {
  return (
    <Card>
      <CardHeader>
        <Text as="h2" variant="title-small">
          Approvals
        </Text>
      </CardHeader>
      <CardBody>
        <PendingApprovalsContent />
      </CardBody>
      <CardFooter>
        <Flex justify="end">
          <PendingApprovalsActions />
        </Flex>
      </CardFooter>
    </Card>
  );
}

/**
 * The card's footer: the way to the approvals page, whatever the count, since
 * that is also where somebody's own requests are.
 *
 * In the card's actions rather than as an `InfoCard` deep link, because the
 * home-page extensions draw their own card and take only `Content` and
 * `Actions` from this one. This way the standalone card and both extensions
 * are the same card.
 *
 * @internal
 */
export function PendingApprovalsActions() {
  const rootPath = useRouteRef(rootRouteRef);

  return (
    <ButtonLink
      href={rootPath()}
      variant="tertiary"
      iconEnd={<RiArrowRightLine aria-hidden />}
    >
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
    () => api.listRequests({ ...INBOX_QUERY, limit: 1 }),
    [api, version],
  );

  // The first load only; a refresh keeps the old number until the new one
  // arrives rather than flashing a placeholder on the home page.
  if (state.loading && !state.value) {
    return (
      <Flex align="center" gap="3" aria-busy="true">
        <Skeleton width={48} height={48} />
        <Flex direction="column" gap="2" grow>
          <Skeleton width={40} height={28} />
          <Skeleton width="70%" height={16} />
        </Flex>
      </Flex>
    );
  }

  // A home card that cannot reach its backend says so and stays out of the
  // way. Throwing here would take the whole home page with it.
  if (state.error) {
    return (
      <Alert
        status="warning"
        icon
        title={`Could not load your approvals: ${state.error.message}`}
      />
    );
  }

  const count = state.value?.totalItems ?? 0;

  return (
    <Flex align="center" gap="4">
      <span
        className={styles.badge}
        data-waiting={count > 0 || undefined}
        aria-hidden="true"
      >
        <ApprovalsIcon fontSize="inherit" />
      </span>
      <Flex direction="column" gap="1">
        <Text variant="title-large" className={styles.count}>
          {count}
        </Text>
        {/* `body-large`, the size of the body text in the MUI cards a home
            page puts beside this one. */}
        <Text variant="body-large" color="secondary">
          {count === 0
            ? 'Nothing is waiting on you.'
            : `${
                count === 1 ? 'request is' : 'requests are'
              } waiting on your decision.`}
        </Text>
        {count > 0 && (
          <Link href={rootPath()} weight="bold">
            Review them
          </Link>
        )}
      </Flex>
    </Flex>
  );
}
