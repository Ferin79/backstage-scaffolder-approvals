import { coreExtensionData } from '@backstage/frontend-plugin-api';
import { createExtensionTester } from '@backstage/frontend-test-utils';
import alphaPlugin from './alpha';
import {
  ApprovalsIndexPage,
  PendingApprovalsHomePageCard,
  scaffolderApprovalsPlugin,
} from './plugin';
import {
  requestRouteRef,
  rootRouteRef,
  scaffolderTaskRouteRef,
  scaffolderTemplateRouteRef,
} from './routes';

/**
 * The package dual-ships, so both entrypoints have to construct. The
 * point of the smoke test is that the two wirings cannot drift apart unnoticed
 * — they mount the same components, and only the wiring is duplicated.
 */
describe('dual-shipped plugin definitions', () => {
  describe('the legacy frontend system', () => {
    it('constructs and exposes its routes', () => {
      expect(scaffolderApprovalsPlugin.getId()).toBe('scaffolder-approvals');
      expect(scaffolderApprovalsPlugin.routes).toEqual({
        root: rootRouteRef,
        request: requestRouteRef,
      });
      // The links into the scaffolder, which an app binds to its pages.
      expect(scaffolderApprovalsPlugin.externalRoutes).toEqual({
        scaffolderTask: scaffolderTaskRouteRef,
        scaffolderTemplate: scaffolderTemplateRouteRef,
      });
    });

    it('provides the approvals API', () => {
      const apis = [...scaffolderApprovalsPlugin.getApis()];
      expect(apis).toHaveLength(1);
      expect(apis[0].api.id).toBe('plugin.scaffolder-approvals.service');
    });

    it('exposes the page extension', () => {
      expect(ApprovalsIndexPage).toBeDefined();
    });

    it('exposes the home-page card', () => {
      expect(PendingApprovalsHomePageCard).toBeDefined();
    });
  });

  describe('the new frontend system', () => {
    it('constructs with the same plugin id', () => {
      expect(alphaPlugin.id).toBe('scaffolder-approvals');
    });

    it('carries an api and a page extension', () => {
      // Both wirings have to provide the API, or one of the two ways to install
      // this plugin would render a page whose data source is missing.
      //
      // Looked up by id rather than enumerated, because the id is what an
      // app-config references when overriding or disabling an extension — and
      // `getExtension` type-checks the id against the plugin's extension map,
      // so a rename fails to compile rather than failing at runtime.
      expect(
        alphaPlugin.getExtension('api:scaffolder-approvals/approvals'),
      ).toBeDefined();
      expect(
        alphaPlugin.getExtension('page:scaffolder-approvals'),
      ).toBeDefined();
    });

    it('gives the page a nav title and icon', () => {
      // There is no `NavItemBlueprint` in this Backstage version: a page
      // carries its own title and icon and the app builds the sidebar entry
      // from them. Without these the page is reachable only by URL, which for
      // an inbox means the people who need it never find it.
      const tester = createExtensionTester(
        alphaPlugin.getExtension('page:scaffolder-approvals'),
      );

      expect(tester.get(coreExtensionData.title)).toBe('Approvals');
      expect(tester.get(coreExtensionData.icon)).toBeDefined();
    });

    it('carries the home-page widget, so both wirings offer the card', () => {
      expect(
        alphaPlugin.getExtension(
          'home-page-widget:scaffolder-approvals/pendingApprovals',
        ),
      ).toBeDefined();
    });
  });

  it('names the same route refs from both entrypoints', () => {
    // A route ref is how other plugins link here, so the two entrypoints
    // disagreeing would break deep links for half of all installations.
    expect(Object.keys(alphaPlugin.routes).sort()).toEqual(
      Object.keys(scaffolderApprovalsPlugin.routes).sort(),
    );
    expect(Object.keys(alphaPlugin.externalRoutes).sort()).toEqual(
      Object.keys(scaffolderApprovalsPlugin.externalRoutes).sort(),
    );
  });
});
