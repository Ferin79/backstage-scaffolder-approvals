/*
 * Copyright 2023 The Backstage Authors
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

import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests for the scaffolder approvals plugins, in
 * packages/app/e2e-tests. See CONTRIBUTING.md for how to run them.
 *
 * The frontend is built for production and served by the backend, which
 * starts with app-config.e2e.yaml on top of app-config.yaml: a port of its
 * own, a fresh in-memory database, the tests' templates and people, and a
 * sign-in provider that lets a test be anyone.
 */

const CI = Boolean(process.env.CI);
const BACKEND_URL = process.env.E2E_BACKEND_URL ?? 'http://localhost:7077';
const APP_URL = process.env.E2E_APP_URL ?? BACKEND_URL;

const configArgs = ['app-config.yaml', 'app-config.e2e.yaml']
  .map(file => `--config "${resolve(__dirname, file)}"`)
  .join(' ');

export default defineConfig({
  testDir: 'packages/app/e2e-tests',
  timeout: 120_000,
  // Generous, because a fresh browser loading the whole app on a busy
  // machine can take this long; a failing assertion only waits it out.
  expect: { timeout: 30_000 },

  fullyParallel: true,
  workers: 2,
  forbidOnly: CI,
  retries: CI ? 1 : 0,

  reporter: CI
    ? [
        ['list'],
        ['github'],
        ['html', { open: 'never', outputFolder: 'e2e-test-report' }],
      ]
    : [['list'], ['html', { open: 'never', outputFolder: 'e2e-test-report' }]],

  webServer: {
    // The frontend's dev server is too slow to hand every test a fresh
    // browser, so the backend serves a production build instead.
    command: `yarn workspace app build && yarn workspace backend start ${configArgs}`,
    url: `${BACKEND_URL}/.backstage/health/v1/readiness`,
    reuseExistingServer: !CI,
    timeout: 15 * 60_000,
    stdout: 'pipe',
  },

  use: {
    baseURL: APP_URL,
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-first-failure',
  },

  outputDir: 'node_modules/.cache/e2e-test-results',

  projects: [
    {
      // Waits for the catalog to hold the tests' people and templates, and
      // makes the requests the retention project ages.
      name: 'setup',
      testMatch: /global\.setup\.ts/,
    },
    {
      name: 'approvals',
      testMatch: /\.test\.ts$/,
      testIgnore: /retention\.test\.ts$/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Last, because the retention sweep redacts every request settled more
      // than two minutes ago, which would pull values out from under tests
      // still running.
      name: 'retention',
      testMatch: /retention\.test\.ts$/,
      dependencies: ['approvals'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
