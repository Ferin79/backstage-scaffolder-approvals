import {
  DEFAULT_NAMESPACE,
  stringifyEntityRef,
} from '@backstage/catalog-model';
import { alertApiRef, useApi } from '@backstage/core-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import type { ReviewStepProps } from '@backstage/plugin-scaffolder-react';
import {
  type ParsedTemplateSchema,
  ReviewState,
} from '@backstage/plugin-scaffolder-react/alpha';
import type { TemplateEntityV1beta3 } from '@backstage/plugin-scaffolder-common';
import type { JsonObject } from '@backstage/types';
import {
  Alert,
  Button,
  Card,
  CardBody,
  Flex,
  Skeleton,
  Text,
} from '@backstage/ui';
import { RiArrowLeftLine, RiSendPlaneLine } from '@remixicon/react';
import { useCallback, useState } from 'react';
import { useParams } from 'react-router-dom';
import useAsync from 'react-use/esm/useAsync';
import { ApprovalsIcon } from '../ApprovalsIcon';
import { messageOf } from '../errors';
import { PolicySummary } from '../PolicySummary';
import { readGate } from '../readGate';
import { useSubmitApprovalRequest } from '../useSubmitApprovalRequest';
import styles from './GatedReviewStep.module.css';

/** @public */
export interface GatedReviewStepProps extends ReviewStepProps {
  /**
   * What to render when the template is not gated, which is most of them.
   *
   * Required rather than defaulted, because this component deliberately does
   * not reimplement the scaffolder's own review step. Setting a
   * `ReviewStepComponent` replaces the scaffolder's built-in review step, which
   * it does not export, so this has to be a complete one: the review table
   * plus Back and Create.
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
  const alertApi = useApi(alertApiRef);
  const submitRequest = useSubmitApprovalRequest();
  const [busy, setBusy] = useState(false);

  // The scaffolder routes the wizard as `/templates/:namespace/:templateName`,
  // which is what the wizard has in its URL. There is nothing in
  // `ReviewStepProps` that names the template, so without an explicit prop this
  // is the only place to learn it. There is no kind in that route: what the
  // scaffolder runs is always a Template.
  //
  // If the shape ever changes, `templateRef` is undefined and this renders the
  // ordinary review step — the behaviour an app had before installing this,
  // rather than a broken screen.
  const { namespace, templateName } = useParams();
  const templateRef =
    props.templateRef ??
    (templateName
      ? stringifyEntityRef({
          kind: 'Template',
          // The scaffolder's older `/templates/:templateName` route has no
          // namespace, and means the default one.
          namespace: namespace ?? DEFAULT_NAMESPACE,
          name: templateName,
        })
      : undefined);

  const state = useAsync(async () => {
    if (!templateRef) {
      return undefined;
    }
    const entity = (await catalogApi.getEntityByRef(templateRef)) as
      | TemplateEntityV1beta3
      | undefined;
    // The same reading the template card on the Create page uses, and the
    // same checks the backend runs at submit, so a template it would refuse is
    // not offered for approval in the first place.
    return entity && readGate(entity, templateRef);
  }, [catalogApi, templateRef]);

  const submit = useCallback(async () => {
    setBusy(true);
    try {
      await submitRequest(
        { templateRef: templateRef!, values: formData as JsonObject },
        'Approval requested',
      );
    } catch (error) {
      // The backend validates the values against the template's own parameter
      // schema and refuses in words worth reading, so show what it said.
      alertApi.post({
        message: `Could not request approval: ${messageOf(error)}`,
        severity: 'error',
      });
    } finally {
      setBusy(false);
    }
  }, [alertApi, formData, submitRequest, templateRef]);

  if (state.loading) {
    return (
      <Flex direction="column" gap="3" aria-busy="true">
        <Skeleton height={96} />
        <Skeleton height={88} />
      </Flex>
    );
  }

  // Not gated, or the catalog could not say. Either way this is an ordinary
  // template and the ordinary review step applies: failing open here costs
  // nothing, because the gate is what enforces anything.
  const check = state.value;
  if (!check) {
    return <>{children}</>;
  }

  return (
    <Flex direction="column" gap="4">
      {/* What is being asked for, before who is being asked: these values are
          exactly what the approvers judge and what the approval is bound to. */}
      <ReviewState
        formState={formData}
        // The stepper passes its parsed steps, titles included; the prop type
        // is narrower than what arrives.
        schemas={props.steps as ParsedTemplateSchema[]}
      />

      {check.usable ? (
        <>
          <Card className={styles.notice}>
            <CardBody>
              <Flex gap="3" align="start">
                <span className={styles.icon} aria-hidden="true">
                  <ApprovalsIcon fontSize="inherit" />
                </span>
                {/* A column, because `Text` is inline: in a plain box the
                    heading and the sentences after it run together. */}
                <Flex direction="column" gap="2">
                  <Text as="h3" variant="body-large" weight="bold">
                    This template needs approval
                  </Text>
                  <Text color="secondary">
                    Submitting does not run it. It creates a request, and the
                    template runs on its own once the approvers below agree.
                  </Text>
                  {/* Who will be asked, from the policy the request will
                      freeze: "who sees this" is the question people have at
                      this point, and a gate naming a group nobody is in is
                      worth noticing before waiting three days for it. */}
                  <PolicySummary policy={check.policy} linkTarget="_blank" />
                </Flex>
              </Flex>
            </CardBody>
          </Card>

          {/* Back, then the step's own action at the far end, where the
              scaffolder's review step puts Create. */}
          <Flex gap="2" justify="end">
            <Button
              variant="tertiary"
              isDisabled={busy}
              onPress={props.handleBack}
              iconStart={<RiArrowLeftLine aria-hidden />}
            >
              Back
            </Button>
            <Button
              variant="primary"
              isDisabled={busy}
              isPending={busy}
              onPress={submit}
              data-testid="request-approval"
              iconStart={<RiSendPlaneLine aria-hidden />}
            >
              Request approval
            </Button>
          </Flex>
        </>
      ) : (
        <>
          {/* Said here rather than after the click: the backend would refuse
              it whatever was filled in, and the problem is the template's,
              which the requester cannot fix by editing the form. */}
          <Alert
            role="alert"
            status="danger"
            icon
            title="This template cannot be requested yet"
            description={
              <Flex direction="column" gap="1">
                <Text variant="body-small">{check.problem}</Text>
                <Text variant="body-small">
                  The problem is in the template, not in what you filled in. Its
                  owner needs to fix it before anyone can ask for it.
                </Text>
              </Flex>
            }
          />

          <Flex gap="2" justify="end">
            <Button
              variant="tertiary"
              onPress={props.handleBack}
              iconStart={<RiArrowLeftLine aria-hidden />}
            >
              Back
            </Button>
          </Flex>
        </>
      )}
    </Flex>
  );
}
