import { configApiRef, useApi, useRouteRef } from '@backstage/core-plugin-api';
import { PluginHeader } from '@backstage/ui';
import type { ReactNode } from 'react';
import { Helmet } from 'react-helmet';
import { rootRouteRef } from '../routes';
import { ApprovalsIcon } from './ApprovalsIcon';

/** Where "Your requests" lives, under the plugin's root. */
export const YOUR_REQUESTS_PATH = '/mine';

/**
 * What the browser tab says: the page's title, then the app's name.
 *
 * The shape core-components' header used to set, through the same Helmet, so
 * it hands over cleanly to and from pages that still use that header. The
 * innermost one wins, so a page can name itself once it knows what it shows.
 *
 * @internal
 */
export function DocumentTitle(props: { title: string }) {
  const { title } = props;
  const appTitle =
    useApi(configApiRef).getOptionalString('app.title') ?? 'Backstage';
  return (
    <Helmet
      titleTemplate={`${title} | %s | ${appTitle}`}
      defaultTitle={`${title} | ${appTitle}`}
    />
  );
}

/**
 * The frame every approvals page sits in: BUI's plugin header, naming the
 * plugin, with the inbox and your own requests as its tabs.
 *
 * The tabs are routes rather than in-page state, so each list has an address:
 * going back from a request returns to the list it was opened from, and
 * "Your requests" can be linked to.
 *
 * Drawn by the plugin in both frontend systems: the new one is told not to
 * draw its own (`noHeader`), so the two look the same.
 *
 * @internal
 */
export function ApprovalsLayout(props: {
  /**
   * What the browser tab says, before the app's name. Left out by a page that
   * names itself only once it has loaded: changing the title twice in quick
   * succession races the notifications plugin's unread counter, which
   * rewrites the title as it changes and could put the first one back.
   */
  title?: string;
  /**
   * Whether to show the two lists as tabs. A request page leaves them out:
   * it belongs to neither list, and two tabs with neither selected read as a
   * choice to make. Its way back is the plugin's name, which links to the
   * inbox.
   */
  tabs?: boolean;
  children: ReactNode;
}) {
  const { title, tabs = true, children } = props;
  const rootPath = useRouteRef(rootRouteRef)();

  return (
    <>
      {title && <DocumentTitle title={title} />}
      <PluginHeader
        icon={<ApprovalsIcon fontSize="inherit" />}
        title="Approvals"
        titleLink={rootPath}
        tabs={
          tabs
            ? [
                {
                  id: 'inbox',
                  label: 'Waiting on you',
                  href: rootPath,
                  matchStrategy: 'exact',
                },
                {
                  id: 'mine',
                  label: 'Your requests',
                  href: `${rootPath}${YOUR_REQUESTS_PATH}`,
                },
              ]
            : undefined
        }
      />
      {children}
    </>
  );
}
