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
