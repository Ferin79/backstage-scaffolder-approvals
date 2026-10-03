# Backstage with scaffolder approvals

A [Backstage](https://backstage.io) app with approval gates for software templates. A gated template does not run when someone submits it. It creates an **approval request**, and runs only once the designated approvers agree. If they deny it, it never runs at all.

The gate is a step in the template, so it holds even against someone calling the scaffolder API directly. See the [plugin guide](docs/README.md) for how it works and what to know before relying on it.

## What is in here

| Path                                                             | What it is                                                                                                                |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [`packages/app`](packages/app)                                   | The Backstage frontend, with the approvals page, a sidebar item, a home-page card and the gated review step               |
| [`packages/backend`](packages/backend)                           | The Backstage backend, with the approvals backend, the `approval:gate` action and the catalog module                      |
| [`plugins/`](plugins)                                            | The six `scaffolder-approvals` packages                                                                                   |
| [`examples/scaffolder-approvals`](examples/scaffolder-approvals) | Two gated example templates, a small one and a production-shaped one, and the people, group and catalog entities they use |
| [`docs/`](docs)                                                  | The plugin guide, plus the design record, implementation guide and review                                                 |
| [`scripts/verify-gate.sh`](scripts/verify-gate.sh)               | Checks, against a running backend, that the gate cannot be skipped by calling the scaffolder directly                     |

The app is Backstage 1.55 on the **legacy frontend system**. That is deliberate: the review step that lets a requester submit a gated template from the scaffolder's own wizard needs a hook only the legacy scaffolder page has. The plugins also ship a new-frontend-system entry point (`/alpha`), but there a requester could not submit from the UI.

## Running it

Node 22 or 24, and Yarn (the repo pins its own version).

```sh
yarn install
yarn start
```

Open <http://localhost:3000> and press **Enter** on the Guest card. The browser remembers that choice, so later visits sign you in by themselves; clear the site's storage to see the card again. [Trying an approval end to end](#trying-an-approval-end-to-end) shows how to sign in as one of the example's people. Data is kept in `packages/backend/.local-db/`, so it survives a restart; delete that folder to start clean.

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
- **Notification links** point at `http://localhost:3000/scaffolder-approvals/requests/<id>`. An open request page, the inbox and the home-page card update themselves through signals, so somebody else's decision appears without a reload — but switching who you are signed in as still needs one.

For something closer to a real template, try **Provision a production service**, in [`examples/scaffolder-approvals/provision-service/`](examples/scaffolder-approvals/provision-service/). Its four pages use every kind of form input except a secret, which a gated template cannot have, and some fields appear only for certain answers. After the gate come 15 steps that look things up in the catalog, render a skeleton, write catalog entities and send notifications. It runs without credentials unless **Publish to GitHub** is ticked, which needs a token in `integrations.github`. [§16 of the browser review](docs/GATED_SCAFFOLDER_BROWSER_REVIEW.md#16-a-production-shaped-template) records what it was used to test.

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

[CI](.github/workflows/ci.yml) runs the formatting check, type-check, lint, build and tests on every pull request and push to `main`.

## Releasing

The six plugins are published to npm under `@ferin79` and always share one version.

1. Bump all six, commit, and merge to `main`:

   ```sh
   yarn workspaces foreach -A --no-private version 0.0.2
   ```

2. Tag the merged commit and push the tag:

   ```sh
   git tag v0.0.2
   git push origin v0.0.2
   ```

   The [release workflow](.github/workflows/release.yml) checks that the tag matches every package's version, then type-checks, builds, tests, and stages each package to npm with provenance. A pre-release version such as `v0.1.0-next.1` is staged under the `next` dist-tag; any other under `latest`.

3. **Approve the staged versions.** The workflow's npm token can only stage, so nothing is public until a maintainer approves each version with 2FA, on npmjs.com or from a terminal (npm 11.15 or later):

   ```sh
   npm stage list @ferin79/backstage-plugin-scaffolder-approvals
   npm stage approve <stage-id>
   ```

   Approve all six together. The packages depend on each other at `^<version>`, which for a `0.0.x` version means that exact version.

Re-running the workflow skips versions already published, but cannot stage a version that is staged and still awaiting approval; approve or reject it first.

## Notes

- **Where this came from.** The plugins were built in a fork of [`backstage/community-plugins`](https://github.com/backstage/community-plugins) and moved here with their history. They were written under the `@backstage-community/` scope, which belongs to the Backstage project, and are published as `@ferin79/backstage-plugin-*` instead.
- **`@yarnpkg/core` is pinned to 4.9.1** in the root `package.json`. Version 4.9.2 depends on `got` through a patch file that only exists in yarn's own repository, so a fresh install fails to resolve. Drop the pin once a fixed version is out.
