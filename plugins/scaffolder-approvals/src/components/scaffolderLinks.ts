import { parseEntityRef } from '@backstage/catalog-model';
import { useRouteRef } from '@backstage/core-plugin-api';
import type { JsonObject } from '@backstage/types';
import { useCallback } from 'react';
import { scaffolderTaskRouteRef, scaffolderTemplateRouteRef } from '../routes';

/**
 * The scaffolder's page for a task, or `undefined` when there is no task yet
 * or the app has not bound {@link scaffolderTaskRouteRef}.
 */
export function useScaffolderTaskLink(
  taskId: string | undefined,
): string | undefined {
  const taskRoute = useRouteRef(scaffolderTaskRouteRef);
  return taskId && taskRoute ? taskRoute({ taskId }) : undefined;
}

/**
 * Builds the scaffolder's form for a template, filled in with `values` through
 * the `formData` query parameter the wizard reads. `undefined` when the app
 * has not bound {@link scaffolderTemplateRouteRef}.
 */
export function useTemplateFormLink():
  | ((templateRef: string, values: JsonObject) => string)
  | undefined {
  const templateRoute = useRouteRef(scaffolderTemplateRouteRef);
  const link = useCallback(
    (templateRef: string, values: JsonObject) => {
      const { namespace, name } = parseEntityRef(templateRef);
      const query = new URLSearchParams({ formData: JSON.stringify(values) });
      return `${templateRoute!({ namespace, templateName: name })}?${query}`;
    },
    [templateRoute],
  );
  return templateRoute ? link : undefined;
}
