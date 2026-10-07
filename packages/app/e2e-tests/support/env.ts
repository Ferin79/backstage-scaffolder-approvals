import { resolve } from 'node:path';

/**
 * Where the app under test runs. playwright.config.ts starts the backend with
 * app-config.e2e.yaml, which puts it on this port and has it serve the built
 * frontend too.
 */
export const BACKEND_URL =
  process.env.E2E_BACKEND_URL ?? 'http://localhost:7077';
export const APP_URL = process.env.E2E_APP_URL ?? BACKEND_URL;

/**
 * The folder the catalog reads `*.yaml` templates from while tests run; see
 * the last location in app-config.e2e.yaml.
 */
export const RUNTIME_TEMPLATES_DIR = resolve(
  __dirname,
  '..',
  'catalog',
  'runtime',
);

/** Where tests leave things for later tests in the same run to read. */
export const RUN_STATE_DIR = resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'node_modules',
  '.cache',
  'e2e-run-state',
);

/** How long a submitted request's values are kept, from app-config.e2e.yaml. */
export const REDACT_AFTER_MS = 2 * 60 * 1000;
