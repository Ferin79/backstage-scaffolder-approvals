import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { type BackstageApi, expectStatus } from './api';
import { RUNTIME_TEMPLATES_DIR } from './env';

export const GATED_ANNOTATION = 'scaffolder-approvals.backstage.io/gated';

interface Entity {
  kind: string;
  metadata: {
    uid: string;
    name: string;
    description?: string;
    annotations?: Record<string, string>;
  };
  spec?: Record<string, unknown>;
}

/** What a runtime template looks like; everything else is fixed. */
export interface TemplateShape {
  /** The form's one page. Defaults to a required `target` text field. */
  properties?: Record<string, unknown>;
  required?: string[];
  /** The gate's approvers; devx-team by default. */
  approvers?: string[];
  /** The gate's quorum; one by default. */
  quorum?: number;
  /** What the step after the gate logs. Changing it changes the steps. */
  message?: string;
  /** Changing it changes nothing an approver is told about. */
  description?: string;
}

export async function getEntity(
  api: BackstageApi,
  kind: string,
  name: string,
): Promise<Entity | undefined> {
  const response = await api.fetch(
    'GET',
    `/api/catalog/entities/by-name/${kind}/default/${name}`,
  );
  if (response.status() === 404) {
    return undefined;
  }
  await expectStatus(response, 200);
  return response.json();
}

/** Ask the catalog to process an entity, and the location it came from, now. */
export async function refreshEntity(
  api: BackstageApi,
  entityRef: string,
): Promise<void> {
  const response = await api.fetch('POST', '/api/catalog/refresh', {
    data: { entityRef },
  });
  await expectStatus(response, 200);
}

let runtimeLocation: Promise<string> | undefined;

/**
 * The location entity for the runtime templates folder, which is what has to
 * be refreshed for the catalog to notice a new file in it.
 */
export function runtimeLocationRef(api: BackstageApi): Promise<string> {
  runtimeLocation ??= (async () => {
    let ref: string | undefined;
    await expect
      .poll(
        async () => {
          const response = await api.fetch(
            'GET',
            '/api/catalog/entities/by-query',
            { params: { filter: 'kind=location', limit: 500 } },
          );
          await expectStatus(response, 200);
          const { items } = (await response.json()) as {
            items: { metadata: { name: string }; spec: { target: string } }[];
          };
          const location = items.find(item =>
            item.spec.target
              .replace(/\\/g, '/')
              .endsWith('/e2e-tests/catalog/runtime/*.yaml'),
          );
          ref = location && `location:default/${location.metadata.name}`;
          return ref;
        },
        { message: 'the runtime templates location', timeout: 60_000 },
      )
      .toBeTruthy();
    return ref!;
  })();
  runtimeLocation.catch(() => {
    runtimeLocation = undefined;
  });
  return runtimeLocation;
}

/**
 * A gated template a test writes into the catalog, and can then edit,
 * delete or replace under a request that is waiting on it.
 *
 * One approval from devx-team; a `target` field unless the shape says
 * otherwise. Each revision is marked in the description, so a test can wait
 * for the catalog to serve the one it just wrote.
 */
export class RuntimeTemplate {
  readonly ref: string;
  private readonly file: string;
  private revision = 0;

  constructor(private readonly api: BackstageApi, readonly name: string) {
    this.ref = `template:default/${name}`;
    this.file = join(RUNTIME_TEMPLATES_DIR, `${name}.yaml`);
  }

  get title(): string {
    return `Runtime ${this.name}`;
  }

  private entityFor(shape: TemplateShape) {
    return {
      apiVersion: 'scaffolder.backstage.io/v1beta3',
      kind: 'Template',
      metadata: {
        name: this.name,
        title: this.title,
        description: `${shape.description ?? 'Written by a test'} (revision ${
          this.revision
        })`,
      },
      spec: {
        type: 'service',
        owner: 'group:default/devx-team',
        parameters: [
          {
            title: 'Target',
            required: shape.required ?? ['target'],
            properties: shape.properties ?? {
              target: { title: 'Target', type: 'string' },
            },
          },
        ],
        steps: [
          {
            id: 'gate',
            name: 'Await approval',
            action: 'approval:gate',
            input: {
              approvers: shape.approvers ?? ['group:default/devx-team'],
              quorum: shape.quorum ?? 1,
              summary: `${this.name} for \${{ parameters.target }}`,
              values: '${{ parameters }}',
            },
          },
          {
            id: 'after',
            name: 'After the gate',
            action: 'debug:log',
            input: { message: shape.message ?? `${this.name} ran` },
          },
        ],
      },
    };
  }

  /**
   * Write the template, or a new revision of it, and wait until the catalog
   * serves exactly that, gated.
   */
  async publish(shape: TemplateShape = {}): Promise<Entity> {
    this.revision += 1;
    // JSON is YAML, and needs no YAML library.
    await writeFile(
      this.file,
      JSON.stringify(this.entityFor(shape), null, 2),
      'utf8',
    );
    const marker = `(revision ${this.revision})`;
    return this.waitFor(
      entity =>
        Boolean(entity?.metadata.description?.endsWith(marker)) &&
        entity?.metadata.annotations?.[GATED_ANNOTATION] === 'true',
      `${this.ref} at revision ${this.revision}`,
    );
  }

  async uid(): Promise<string> {
    const entity = await getEntity(this.api, 'template', this.name);
    expect(entity, `${this.ref} in the catalog`).toBeDefined();
    return entity!.metadata.uid;
  }

  /** Delete the template from the catalog for good: file and entity. */
  async remove(): Promise<void> {
    await rm(this.file, { force: true });
    await this.deleteEntity();
    await expect
      .poll(async () => getEntity(this.api, 'template', this.name), {
        message: `${this.ref} to be gone`,
      })
      .toBeUndefined();
  }

  /**
   * Delete the entity and let the catalog read the file again: the same name
   * and content, under a new uid.
   */
  async recreate(): Promise<void> {
    const before = await this.uid();
    await this.deleteEntity();
    await this.waitFor(
      entity => Boolean(entity) && entity!.metadata.uid !== before,
      `${this.ref} to come back with a new uid`,
    );
  }

  /** Tidy up after a test; whatever state it was left in. */
  async dispose(): Promise<void> {
    await rm(this.file, { force: true });
    await this.deleteEntity().catch(() => undefined);
  }

  private async deleteEntity(): Promise<void> {
    const entity = await getEntity(this.api, 'template', this.name);
    if (!entity) {
      return;
    }
    const response = await this.api.fetch(
      'DELETE',
      `/api/catalog/entities/by-uid/${entity.metadata.uid}`,
    );
    await expectStatus(response, 204);
  }

  /**
   * Refresh until the catalog serves an entity `ready` accepts. A new file is
   * only noticed through its location; a known template refreshes its
   * location along with itself.
   */
  private async waitFor(
    ready: (entity: Entity | undefined) => boolean,
    what: string,
  ): Promise<Entity> {
    let current: Entity | undefined;
    await expect
      .poll(
        async () => {
          current = await getEntity(this.api, 'template', this.name);
          if (ready(current)) {
            return true;
          }
          await refreshEntity(
            this.api,
            current ? this.ref : await runtimeLocationRef(this.api),
          );
          return false;
        },
        { message: what, timeout: 60_000, intervals: [500, 1_000, 2_000] },
      )
      .toBe(true);
    return current!;
  }
}
