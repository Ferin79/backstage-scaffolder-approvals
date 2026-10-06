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

import { createElement } from 'react';

/** The sizes Backstage's `IconComponent` asks for, as Material UI sizes them. */
const SIZES = {
  small: '1.25rem',
  medium: '1.5rem',
  large: '2.1875rem',
  inherit: 'inherit',
} as const;

/**
 * A clipboard with a tick: a list of things waiting to be agreed to.
 *
 * Shaped as Backstage's `IconComponent` (a `fontSize` prop, not Remix Icon's
 * `size`), which is what the nav item and the template card's links take.
 * `currentColor` makes it follow the colour of whatever it sits in, in both
 * themes.
 *
 * `createElement` rather than JSX, so the `.ts` alpha entrypoint can use it.
 */
export function ApprovalsIcon(props: { fontSize?: keyof typeof SIZES }) {
  const size = SIZES[props.fontSize ?? 'medium'];
  return createElement(
    'svg',
    {
      width: '1em',
      height: '1em',
      style: { fontSize: size, flexShrink: 0 },
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
    },
    createElement('path', {
      d: 'M9 4H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2',
    }),
    createElement('rect', { x: 9, y: 2, width: 6, height: 4, rx: 1 }),
    createElement('path', { d: 'm9 14 2 2 4-4' }),
  );
}
