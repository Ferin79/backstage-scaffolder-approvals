import { createBackendModule } from '@backstage/backend-plugin-api';
import { InputError, NotAllowedError } from '@backstage/errors';
import {
  authProvidersExtensionPoint,
  createProxyAuthenticator,
  createProxyAuthProviderFactory,
} from '@backstage/plugin-auth-node';

/** A catalog user's name; anything else is refused before the catalog sees it. */
const USER_NAME = /^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/;

const e2eAuthenticator = createProxyAuthenticator({
  defaultProfileTransform: async () => ({ profile: {} }),
  // Disabled anywhere but a development backend, like the guest provider.
  initialize: () => ({ disabled: process.env.NODE_ENV !== 'development' }),
  async authenticate({ req }, { disabled }) {
    if (disabled) {
      throw new NotAllowedError(
        'The e2e sign-in provider only works in a development backend',
      );
    }
    const user = req.query.user;
    if (typeof user !== 'string' || !USER_NAME.test(user)) {
      throw new InputError(
        "Pass the catalog user to sign in as, such as '?user=alice'",
      );
    }
    return { result: { userEntityRef: `user:default/${user}` } };
  },
});

/**
 * Sign-in for the end-to-end tests: `GET /api/auth/e2e/refresh?user=alice`
 * signs in as the catalog user `user:default/alice`, with their groups.
 *
 * The approval flow needs several people at once — a requester, two
 * approvers, an outsider — and the guest provider is one fixed person per
 * backend start. This is the guest provider with the person chosen per
 * request. The auth backend mounts it only when `auth.providers.e2e` is
 * configured, which only `app-config.e2e.yaml` does, and it refuses to work
 * outside development.
 */
export default createBackendModule({
  pluginId: 'auth',
  moduleId: 'e2e-provider',
  register(reg) {
    reg.registerInit({
      deps: { providers: authProvidersExtensionPoint },
      async init({ providers }) {
        providers.registerProvider({
          providerId: 'e2e',
          factory: createProxyAuthProviderFactory({
            authenticator: e2eAuthenticator,
            async signInResolver({ result }, ctx) {
              // Only real catalog users, so their groups come from the
              // catalog exactly as they would for a real sign-in.
              return ctx.signInWithCatalogUser({
                entityRef: result.userEntityRef,
              });
            },
          }),
        });
      },
    });
  },
});
