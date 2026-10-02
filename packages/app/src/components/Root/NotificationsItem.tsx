import { SidebarItem } from '@backstage/core-components';
import type { NotificationsRenderItemProps } from '@backstage/plugin-notifications';
import { Tag, TagGroup } from '@backstage/ui';
import { RiNotification2Line } from '@remixicon/react';

/** The sizes the notifications plugin draws its bell at. */
const ICON_SIZES: Record<string, number> = { small: 16, large: 32 };

/** The notifications plugin's own bell, at the sizes a sidebar asks for. */
const NotificationsIcon = (props: { fontSize?: string }) => (
  <RiNotification2Line size={ICON_SIZES[props.fontSize ?? ''] ?? 24} />
);

/**
 * The notifications sidebar item, drawn as the plugin draws it, but with a
 * `textValue` on the unread badge.
 *
 * The plugin (0.6.0) passes the count to BUI's `Tag` as a number, which
 * react-aria takes for "non-plain text" and warns about on every page that
 * shows a count: "A `textValue` prop is required for <Tag> elements …". The
 * browser review had pinned it on the approvals page (B23); it comes from
 * here. A string child and a `textValue` keep the badge exactly as it was
 * and the console quiet.
 */
export const NotificationsItem = (props: NotificationsRenderItemProps) => {
  const { unreadCount, to, onClick } = props;
  const label = unreadCount > 99 ? '99+' : String(unreadCount);
  return (
    <SidebarItem
      to={to}
      onClick={onClick}
      text="Notifications"
      icon={NotificationsIcon}
    >
      {unreadCount > 0 && (
        <TagGroup aria-label="Unread notifications">
          <Tag size="small" textValue={label}>
            {label}
          </Tag>
        </TagGroup>
      )}
    </SidebarItem>
  );
};
