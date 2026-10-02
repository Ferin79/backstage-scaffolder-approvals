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

import { stringifyEntityRef } from '@backstage/catalog-model';
import {
  type IconComponent,
  useApiHolder,
  useRouteRef,
} from '@backstage/core-plugin-api';
import {
  defaultEntityPresentation,
  entityPresentationApiRef,
  entityRouteParams,
  entityRouteRef,
} from '@backstage/plugin-catalog-react';
import type { TemplateEntityV1beta3 } from '@backstage/plugin-scaffolder-common';
import { TemplateCard } from '@backstage/plugin-scaffolder-react/alpha';
import { useMemo } from 'react';
import useAsync from 'react-use/esm/useAsync';
import { rootRouteRef } from '../../routes';
import { ApprovalsIcon } from '../ApprovalsIcon';
import { readGate } from '../readGate';

/**
 * What the scaffolder page hands a `TemplateCardComponent`.
 *
 * Spelled out rather than borrowed from the scaffolder's alpha
 * `TemplateCardProps`, so this public API does not change whenever an alpha
 * one does.
 *
 * @public
 */
export interface GatedTemplateCardProps {
  /** The template the card shows. */
  template: TemplateEntityV1beta3;
  /** Links the app adds to the card, such as "View TechDocs". */
  additionalLinks?: { icon: IconComponent; text: string; url: string }[];
  /** Called with the template when somebody chooses it. */
  onSelected?: (template: TemplateEntityV1beta3) => void;
}

/**
 * The scaffolder's own template card, plus who has to approve a gated one.
 *
 * Without it nothing on **Create…** tells a gated template from any other,
 * and a requester learns that it needs approval on the wizard's last step
 * (B17 in the browser review). Each approver becomes one of the card's links,
 * "Approver: DevX team", to their catalog page: the card's own slot for links
 * an app adds, which is how the scaffolder itself adds "View TechDocs". The
 * card is otherwise the scaffolder's, untouched.
 *
 * Install it as the scaffolder page's `TemplateCardComponent`. It reads the
 * same gate the wizard's review step does, so the two always agree.
 *
 * @public
 */
export function GatedTemplateCard(props: GatedTemplateCardProps) {
  const { template, additionalLinks, onSelected } = props;

  const gate = useMemo(
    () => readGate(template, stringifyEntityRef(template)),
    [template],
  );
  const approvers = gate?.usable ? gate.policy.approvers : [];
  const names = useApproverNames(approvers);

  const entityRoute = useRouteRef(entityRouteRef);
  const approvalsRoute = useRouteRef(rootRouteRef);

  const gateLinks: NonNullable<GatedTemplateCardProps['additionalLinks']> = [];
  if (gate?.usable) {
    approvers.forEach((approver, index) =>
      gateLinks.push({
        icon: ApprovalsIcon,
        text: `Approver: ${names[index]}`,
        url: entityRoute(entityRouteParams(approver)),
      }),
    );
  } else if (gate) {
    // A gate the backend would refuse. The review step says why; here it is
    // enough not to pretend the template runs straight away.
    gateLinks.push({
      icon: ApprovalsIcon,
      text: 'Needs approval',
      url: approvalsRoute(),
    });
  }

  return (
    <TemplateCard
      template={template}
      // The gate first: it changes what choosing this template means.
      additionalLinks={[...gateLinks, ...(additionalLinks ?? [])]}
      // The page hands a replacement card a callback that takes the template;
      // the scaffolder's own card calls its callback with nothing.
      onSelected={onSelected ? () => onSelected(template) : undefined}
    />
  );
}

/**
 * The catalog's names for the approvers, in order.
 *
 * Plain strings, because that is what a card link takes, so this asks the
 * presentation API directly rather than rendering `EntityDisplayName`. Until
 * it answers, and in an app without it, each is the name from the ref.
 */
function useApproverNames(approvers: string[]): string[] {
  const presentationApi = useApiHolder().get(entityPresentationApiRef);
  const fallback = approvers.map(
    approver => defaultEntityPresentation(approver).primaryTitle,
  );

  // A string stands in for the array, which is a new one on every render.
  const key = approvers.join('\n');
  const { value } = useAsync(async () => {
    if (!presentationApi || !key) {
      return undefined;
    }
    return Promise.all(
      key
        .split('\n')
        .map(
          async approver =>
            (await presentationApi.forEntity(approver).promise).primaryTitle,
        ),
    );
  }, [presentationApi, key]);

  return value ?? fallback;
}
