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

import '@testing-library/jest-dom';

// jsdom has no `matchMedia`, and BUI's `useBreakpoint` needs it: the requests
// table drops its secondary columns on a narrow screen. This answers the
// `min-width` queries BUI asks from `window.innerWidth`, which jsdom sets to
// 1024 — so tests see a desktop layout by default, and a test file can narrow
// the window to see the phone one. BUI caches its first answer, and this never
// sends the change events that would move it, so narrow the window before
// anything renders (see RequestsTable.narrow.test.tsx).
if (!window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList => {
    const minWidth = /min-width:\s*(\d+)px/.exec(query);
    return {
      matches: minWidth ? window.innerWidth >= Number(minWidth[1]) : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    };
  };
}
