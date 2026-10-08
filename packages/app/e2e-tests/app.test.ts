/*
 * Copyright 2020 The Backstage Authors
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

import { test, expect } from '@playwright/test';

test('a guest signs in and lands on the home page with the approvals card', async ({
  page,
}) => {
  await page.goto('/');

  const enterButton = page.getByRole('button', { name: 'Enter' });
  await expect(enterButton).toBeVisible();
  await enterButton.click();

  const approvalsCard = page
    .locator('[class*="MuiCard-root"]')
    .filter({ has: page.getByRole('link', { name: 'Open approvals' }) });
  // The guest is nobody's approver.
  await expect(approvalsCard).toContainText('Nothing is waiting on you.');
  await expect(
    page.getByRole('navigation', { name: 'sidebar nav' }).getByRole('link', {
      name: 'Approvals',
    }),
  ).toBeVisible();
});
