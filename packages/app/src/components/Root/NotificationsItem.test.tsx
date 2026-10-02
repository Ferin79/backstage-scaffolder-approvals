import { SidebarOpenStateProvider } from '@backstage/core-components';
import { renderInTestApp } from '@backstage/test-utils';
import { screen } from '@testing-library/react';
import { NotificationsItem } from './NotificationsItem';

/** In an open sidebar, where the item shows its text and its badge. */
function renderOpen(unreadCount: number) {
  return renderInTestApp(
    <SidebarOpenStateProvider value={{ isOpen: true, setOpen: () => {} }}>
      <NotificationsItem
        unreadCount={unreadCount}
        to="/notifications"
        onClick={() => {}}
      />
    </SidebarOpenStateProvider>,
  );
}

describe('NotificationsItem', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  /** react-aria's complaint about the badge, which B23 tracked down. */
  const textValueWarnings = () =>
    warn.mock.calls.filter(([message]) => /textValue/.test(String(message)));

  it('shows the unread count without a react-aria warning', async () => {
    await renderOpen(3);

    expect(
      await screen.findByRole('grid', { name: 'Unread notifications' }),
    ).toHaveTextContent('3');
    expect(screen.getByRole('link')).toHaveAttribute('href', '/notifications');
    expect(textValueWarnings()).toEqual([]);
  });

  it('caps the badge at 99+, as the plugin does', async () => {
    await renderOpen(120);

    expect(
      await screen.findByRole('grid', { name: 'Unread notifications' }),
    ).toHaveTextContent('99+');
    expect(textValueWarnings()).toEqual([]);
  });

  it('shows no badge when nothing is unread', async () => {
    await renderOpen(0);

    expect(
      await screen.findByRole('link', { name: /Notifications/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('grid', { name: 'Unread notifications' }),
    ).not.toBeInTheDocument();
  });
});
