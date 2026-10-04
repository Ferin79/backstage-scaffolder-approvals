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

import { useEntityPresentation } from '@backstage/plugin-catalog-react';
import { Avatar } from '@backstage/ui';

/**
 * A person's (or a group's) initials, from the name the catalog has for them.
 *
 * Decoration only: it always sits beside the name, which is what a screen
 * reader announces. The catalog's presentation API carries no picture, so
 * there is no image to load and BUI's avatar shows its initials.
 *
 * @internal
 */
export function PersonAvatar(props: {
  entityRef: string;
  size?: 'x-small' | 'small' | 'medium';
}) {
  const { entityRef, size = 'small' } = props;
  const { primaryTitle } = useEntityPresentation(entityRef, {
    defaultKind: 'user',
  });
  return <Avatar src="" name={primaryTitle} size={size} purpose="decoration" />;
}
