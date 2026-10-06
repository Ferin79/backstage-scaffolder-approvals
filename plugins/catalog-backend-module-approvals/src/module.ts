import {
  coreServices,
  createBackendModule,
} from '@backstage/backend-plugin-api';
import { catalogProcessingExtensionPoint } from '@backstage/plugin-catalog-node';
import { ApprovalsGateProcessor } from './ApprovalsGateProcessor';

/**
 * Registers the processor that derives the `gated` annotation.
 *
 * Optional. Without it, gated templates are still gated — the gate step is what
 * enforces that — but the UI has no way to tell which templates need an
 * approval, so it will offer to launch them directly and people will meet the
 * gate as a failure rather than as a form.
 *
 * @public
 */
export const catalogModuleApprovals = createBackendModule({
  pluginId: 'catalog',
  moduleId: 'approvals',
  register(env) {
    env.registerInit({
      deps: {
        catalog: catalogProcessingExtensionPoint,
        logger: coreServices.logger,
      },
      async init({ catalog, logger }) {
        catalog.addProcessor(new ApprovalsGateProcessor(logger));
      },
    });
  },
});
