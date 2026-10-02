import { GatedReviewStep } from '@ferin79/backstage-plugin-scaffolder-approvals';
import type { ReviewStepProps } from '@backstage/plugin-scaffolder-react';
import {
  ReviewState,
  type ParsedTemplateSchema,
} from '@backstage/plugin-scaffolder-react/alpha';
import { Button, Flex } from '@backstage/ui';

/**
 * The scaffolder's own last step: the values, then Back and Create.
 *
 * Passing a `ReviewStepComponent` replaces the stepper's built-in review step
 * entirely, and the scaffolder does not export that built-in one, so an app
 * that customises the review step has to supply its own. This one mirrors it.
 */
export const DefaultReviewStep = (props: ReviewStepProps) => (
  <>
    <ReviewState
      formState={props.formData}
      // The stepper passes its parsed steps, titles included; the prop type
      // is just narrower than what arrives.
      schemas={props.steps as ParsedTemplateSchema[]}
    />
    <Flex justify="end" mt="4" gap="2">
      <Button
        variant="tertiary"
        onPress={props.handleBack}
        isDisabled={props.disableButtons}
      >
        Back
      </Button>
      <Button
        variant="primary"
        onPress={props.handleCreate}
        isDisabled={props.disableButtons}
      >
        Create
      </Button>
    </Flex>
  </>
);

/**
 * The review step this app's scaffolder uses.
 *
 * For a gated template it shows who will be asked to approve, and submits an
 * approval request instead of starting a task. For every other template it
 * renders the default review step unchanged.
 */
export const ReviewStep = (props: ReviewStepProps) => (
  <GatedReviewStep {...props}>
    <DefaultReviewStep {...props} />
  </GatedReviewStep>
);
