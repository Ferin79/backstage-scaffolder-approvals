import { parseEntityRef } from '@backstage/catalog-model';
import type { JsonObject } from '@backstage/types';

/**
 * Where the scaffolder's own pages live. Assumed to be its default mount
 * point, `/create`, in one place so that is the only line to change.
 */
const SCAFFOLDER_ROOT = '/create';

/**
 * A task's page in the scaffolder. The requester cannot find an approved run
 * under "my tasks", because the plugin's service principal created it, so
 * this link is how they reach its log at all.
 */
export function scaffolderTaskPath(taskId: string): string {
  return `${SCAFFOLDER_ROOT}/tasks/${encodeURIComponent(taskId)}`;
}

/**
 * The scaffolder's form for a template, filled in with `values`, which the
 * wizard reads from its `formData` query parameter.
 */
export function scaffolderTemplateFormPath(
  templateRef: string,
  values: JsonObject,
): string {
  const { namespace, name } = parseEntityRef(templateRef);
  const query = new URLSearchParams({ formData: JSON.stringify(values) });
  return `${SCAFFOLDER_ROOT}/templates/${encodeURIComponent(
    namespace,
  )}/${encodeURIComponent(name)}?${query}`;
}
