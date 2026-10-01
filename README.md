# Backstage with scaffolder approvals

A [Backstage](https://backstage.io) app with approval gates for software templates. A gated template does not run when someone submits it. It creates an **approval request**, and runs only once the designated approvers agree. If they deny it, it never runs at all.

The gate is a step in the template, so it holds even against someone calling the scaffolder API directly. See the [plugin guide](docs/README.md) for how it works and what to know before relying on it.

## What is in here

| Path                                                             | What it is                                                                                                  |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [`packages/app`](packages/app)                                   | The Backstage frontend, with the approvals page, a sidebar item, a home-page card and the gated review step |
| [`packages/backend`](packages/backend)                           | The Backstage backend, with the approvals backend, the `approval:gate` action and the catalog module        |
| [`plugins/`](plugins)                                            | The six `scaffolder-approvals` packages                                                                     |
| [`examples/scaffolder-approvals`](examples/scaffolder-approvals) | A gated example template, and the people and group its gate names                                           |
| [`docs/`](docs)                                                  | The plugin guide, plus the design record, implementation guide and review                                   |
| [`scripts/verify-gate.sh`](scripts/verify-gate.sh)               | Checks, against a running backend, that the gate cannot be skipped by calling the scaffolder directly       |

The app is Backstage 1.55 on the **legacy frontend system**. That is deliberate: the review step that lets a requester submit a gated template from the scaffolder's own wizard needs a hook only the legacy scaffolder page has. The plugins also ship a new-frontend-system entry point (`/alpha`), but there a requester could not submit from the UI.

## Running it

Node 22 or 24, and Yarn (the repo pins its own version).

```sh
yarn install
yarn start
```

Open <http://localhost:3000> and press **Enter** to sign in as a guest. Data is kept in `packages/backend/.local-db/`, so it survives a restart; delete that folder to start clean.

## Trying an approval end to end

The example template, **Request GitHub admin access**, needs two members of `devx-team` to approve before it runs, and does not let the person asking approve their own request. [`examples/scaffolder-approvals/org.yaml`](examples/scaffolder-approvals/org.yaml) defines `requester`, `alice` and `bob` (all in `devx-team`) and `outsider` (in no group).

Guest sign-in can stand in for any of them: `auth.providers.guest.userEntityRef` makes the guest that catalog user, with their group membership. Restart the backend to switch user:

```sh
# bash
APP_CONFIG_auth_providers_guest_userEntityRef=user:default/requester yarn start
```

```powershell
# PowerShell
$env:APP_CONFIG_auth_providers_guest_userEntityRef = 'user:default/requester'; yarn start
```

1. **As `requester`:** open **Create...**, choose **Request GitHub admin access**, fill it in and press **Review**. The last step says who will be asked; press **Request approval**. You land on the request, which is `pending`.
2. **As `alice`:** restart with `user:default/alice`, then reload the page. **Approvals** (or the card on the home page) lists the request. Open it and press **Approve**. It stays `pending`, one of two.
3. **As `bob`:** restart with `user:default/bob`, reload, and approve. The template starts on its own; the request moves to `running` and then `completed`, and links to the task log, which shows who asked and who agreed.

Things worth trying along the way: approving your own request, approving as `outsider`, denying, withdrawing a pending request, and submitting the same values twice.

Two things to know:

- **Wait for the catalog after a fresh start.** A guest who signs in before the catalog has loaded `org.yaml` gets no groups, and so cannot approve anything. Reload once the catalog has data.
- **Notification links** point at `http://localhost:3000/scaffolder-approvals/requests/<id>`, and the request page does not refresh on its own yet: reload to see somebody else's decision.

## Checking the gate holds

With the backend running:

```sh
./scripts/verify-gate.sh
```

It checks that the example template is marked gated, that invalid values are rejected before anything is stored, and that starting the template straight through the scaffolder API fails at the gate with every later step skipped.

## Development

```sh
yarn tsc          # type-check everything
yarn lint:all     # lint every package
yarn test:all     # run every package's tests, with coverage
yarn prettier:check
yarn build:api-reports
```

To work on the approvals page by itself against a mock API, run `yarn start` inside `plugins/scaffolder-approvals`.

## Notes

- **Where this came from.** The plugins were built in a fork of [`backstage/community-plugins`](https://github.com/backstage/community-plugins) and moved here with their history. They keep the `@backstage-community/` package names they were written under; that npm scope belongs to the Backstage project, so they would need a scope of their own to be published.
- **`@yarnpkg/core` is pinned to 4.9.1** in the root `package.json`. Version 4.9.2 depends on `got` through a patch file that only exists in yarn's own repository, so a fresh install fails to resolve. Drop the pin once a fixed version is out.
