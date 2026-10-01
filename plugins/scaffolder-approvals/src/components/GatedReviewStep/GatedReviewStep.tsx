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
  GATED_ANNOTATION,
  readGatePolicy,
} from '@backstage-community/plugin-scaffolder-approvals-common';
import { Progress } from '@backstage/core-components';
import { alertApiRef, useApi, useRouteRef } from '@backstage/core-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import type { ReviewStepProps } from '@backstage/plugin-scaffolder-react';
import type { TemplateEntityV1beta3 } from '@backstage/plugin-scaffolder-common';
import type { JsonObject } from '@backstage/types';
import { Box, Button, Flex, Text } from '@backstage/ui';
import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import useAsync from 'react-use/esm/useAsync';
import { approvalsApiRef } from '../../api';
import { rootRouteRef } from '../../routes';

/** @public */
export interface GatedReviewStepProps extends ReviewStepProps {
  /**
   * What to render when the template is not gated, which is most of them.
   *
   * Required rather than defaulted, because this component deliberately does
   * not reimplement the scaffolder's own review step. An adopter passes the
   * one they were already using — usually the scaffolder's default.
   */
  children: React.ReactNode;

  /**
   * The template being reviewed, if the caller knows it.
   *
   * `ReviewStepProps` does not carry one, so this otherwise comes from the
   * scaffolder's own route parameters. That couples this component to a URL
   * shape it does not own, which is worth an escape hatch: an app that mounts
   * the wizard somewhere else can say what the template is.
   */
  templateRef?: string;
}

/**
 * The review step for a gated template: ask, rather than run.
 *
 * A gated template cannot be started from the scaffolder's Create button. The
 * gate would throw on step one and the requester would be left reading a failed
 * task, which is exactly the experience the gate's error message apologises
 * for. This replaces that last screen so the wizard ends in a request instead.
 *
 * It is a `ReviewStepComponent` rather than a decorator on `scaffolderApiRef`
 * because of what `scaffold()` has to return. A decorator that diverted a gated
 * submit would have no task id to hand back, and would have to invent one or
 * throw — turning a successful request into something the UI reports as a
 * failure. Replacing the review step means `handleCreate` is simply never
 * called, and the component is free to navigate to the request it just made.
 *
 * **This is convenience, not enforcement.** Remove it and the gate still holds:
 * a template started any other way fails at step one. What it removes is the
 * dead end, not the bypass.
 *
 * @public
 */
export function GatedReviewStep(props: GatedReviewStepProps) {
  const { formData, children } = props;

  const catalogApi = useApi(catalogApiRef);
  const approvalsApi = useApi(approvalsApiRef);
  const alertApi = useApi(alertApiRef);
  const navigate = useNavigate();
  const rootPath = useRouteRef(rootRouteRef);
  const [busy, setBusy] = useState(false);

  // The scaffolder routes a template by namespace/kind/name, which is what the
  // wizard has in its URL. There is nothing in `ReviewStepProps` that names the
  // template, so without an explicit prop this is the only place to learn it.
  //
  // If the shape ever changes, `templateRef` is undefined and this renders the
  // ordinary review step — the behaviour an app had before installing this,
  // rather than a broken screen.
  const { namespace, kind, templateName } = useParams();
  const templateRef =
    props.templateRef ??
    (namespace && kind && templateName
      ? `${kind}:${namespace}/${templateName}`
      : undefined);

  const state = useAsync(async () => {
    if (!templateRef) {
      return undefined;
    }
    const entity = (await catalogApi.getEntityByRef(templateRef)) as
      | TemplateEntityV1beta3
      | undefined;
    if (entity?.metadata.annotations?.[GATED_ANNOTATION] !== 'true') {
      return undefined;
    }
    return entity;
  }, [catalogApi, templateRef]);

  const submit = useCallback(async () => {
    setBusy(true);
    try {
      const created = await approvalsApi.submitRequest({
        templateRef: templateRef!,
        values: formData as JsonObject,
      });
      alertApi.post({
        message: created.collapsed
          ? 'You already have an identical request open'
          : 'Approval requested',
        severity: 'success',
        display: 'transient',
      });
      navigate(`${rootPath()}/requests/${created.id}`);
    } catch (error) {
      // The backend validates the values against the template's own parameter
      // schema and refuses in words worth reading, so show what it said.
      alertApi.post({
        message: `Could not request approval: ${
          error instanceof Error ? error.message : error
        }`,
        severity: 'error',
      });
    } finally {
      setBusy(false);
    }
  }, [alertApi, approvalsApi, formData, navigate, rootPath, templateRef]);

  if (state.loading) {
    return <Progress />;
  }

  // Not gated, or the catalog could not say. Either way this is an ordinary
  // template and the ordinary review step applies: failing open here costs
  // nothing, because the gate is what enforces anything.
  if (!state.value) {
    return <>{children}</>;
  }

  return (
    <Flex direction="column" gap="3">
      <Box>
        <Text variant="title-small">This template needs approval</Text>
        <Text>
          Submitting does not run it. It creates a request, and the template
          runs on its own once the approvers below agree.
        </Text>
      </Box>

      <Approvers entity={state.value} />

      <Flex gap="2">
        <Button
          variant="primary"
          isDisabled={busy}
          onClick={submit}
          data-testid="request-approval"
        >
          Request approval
        </Button>
        <Button
          variant="secondary"
          isDisabled={busy}
          onClick={props.handleBack}
        >
          Back
        </Button>
      </Flex>
    </Flex>
  );
}

/**
 * Who will be asked, read from the gate step the template already carries.
 *
 * Shown before submitting rather than after, because "who sees this" is the
 * question people actually have at this point — and because a gate naming a
 * group nobody is in is worth noticing before waiting three days for it.
 */
function Approvers(props: { entity: TemplateEntityV1beta3 }) {
  const gate = props.entity.spec?.steps?.find(
    step => step.action === 'approval:gate',
  );

  let approvers: string[] = [];
  let quorum = 1;
  try {
    const policy = readGatePolicy(gate?.input);
    approvers = policy.approvers;
    quorum = policy.quorum;
  } catch {
    // An unusable policy is the catalog processor's warning to raise and the
    // backend's to refuse. Here it just means there is nothing to list.
    return null;
  }

  return (
    <Box>
      <Text variant="title-x-small">
        {quorum === 1
          ? 'One of these must approve'
          : `${quorum} of these must approve`}
      </Text>
      {approvers.map(approver => (
        <Text key={approver}>{approver}</Text>
      ))}
    </Box>
  );
}
