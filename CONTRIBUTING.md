# Contributing

This repository is a complete Backstage app with the six Scaffolder Approvals packages wired in, plus example templates and the people to approve them. This page covers running it, trying the approval flow as several people, testing changes, and releasing.

## Repository layout

| Path                                                             | What it is                                                                                                                                  |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| [`plugins/`](plugins)                                            | The six packages. See the [package table](docs/README.md#packages)                                                                          |
| [`packages/app`](packages/app)                                   | The Backstage frontend (legacy frontend system), with the approvals page, sidebar item, home-page card, gated review step and template card |
| [`packages/backend`](packages/backend)                           | The Backstage backend, with the approvals backend, the `approval:gate` action and the catalog module                                        |
| [`examples/scaffolder-approvals`](examples/scaffolder-approvals) | Two gated templates, and the users and group that approve them                                                                              |
| [`docs/`](docs)                                                  | The documentation, screenshots, and the design records                                                                                      |
| [`scripts/verify-gate.sh`](scripts/verify-gate.sh)               | Checks against a running backend that the gate cannot be skipped                                                                            |

The app uses the **legacy frontend system** on purpose: the review step that lets a requester submit from the scaffolder's wizard needs a hook only the legacy scaffolder page has. The plugin also ships a new-frontend-system entry point (`/alpha`).

## Run the app

You need Node 22 or 24. Yarn is pinned by the repository (`.yarn/releases`), so use it through Corepack or the `yarn` on your path.

```sh
yarn install
yarn start
```

Open <http://localhost:3000> and press **Enter** on the Guest card. The browser remembers that choice, so later visits sign you in automatically; clear the site's storage to see the card again.

The first start takes a few minutes while the frontend builds. Data is stored in `packages/backend/.local-db/`, so it survives restarts; delete that folder to start clean.

### What is in the example data

[`examples/scaffolder-approvals/org.yaml`](examples/scaffolder-approvals/org.yaml) defines:

| User        | Display name    | Groups      |
| ----------- | --------------- | ----------- |
| `requester` | Riley Requester | `devx-team` |
| `alice`     | Alice Approver  | `devx-team` |
| `bob`       | Bob Approver    | `devx-team` |
| `outsider`  | Oscar Outsider  | none        |

and two gated templates:

- **Request GitHub admin access** ([`request-github-admin.yaml`](examples/scaffolder-approvals/request-github-admin.yaml)): two members of `devx-team` must approve, and the requester may not approve their own request. Its "grant" step is `debug:log`, so it runs without credentials.
- **Provision a production service** ([`provision-service/`](examples/scaffolder-approvals/provision-service/)): four pages using every kind of form input except secrets, conditional fields, and 15 steps after the gate that look things up in the catalog, render a skeleton, write catalog entities and send notifications. It runs without credentials unless **Publish to GitHub** is ticked, which needs a token in `integrations.github`.

## Try an approval end to end

Guest sign-in can stand in for any of the example users: `auth.providers.guest.userEntityRef` makes the guest that catalog user, with their groups. Restart the backend to switch user.

```sh
# bash
APP_CONFIG_auth_providers_guest_userEntityRef=user:default/requester yarn start
```

```powershell
# PowerShell
$env:APP_CONFIG_auth_providers_guest_userEntityRef = 'user:default/requester'; yarn start
```

1. **As `requester`:** open **Create…**, choose **Request GitHub admin access**, fill it in and press **Review**. The last step says who will be asked; press **Request approval**. You land on the request, which is **Awaiting approval**.
2. **As `alice`:** restart with `user:default/alice` and reload. **Approvals** (or the card on the home page) lists the request. Open it and press **Approve**. It stays pending: one of two.
3. **As `bob`:** restart with `user:default/bob`, reload, and approve. The template starts by itself; the request moves to **Running** and then **Completed**, and links to the task log, which shows who asked and who agreed.

Worth trying along the way: approving your own request, approving as `outsider`, denying, withdrawing a pending request, and submitting the same values twice.

Two things to know:

- **Wait for the catalog after a fresh start.** A guest who signs in before the catalog has loaded `org.yaml` gets no groups and cannot approve anything. Reload once the catalog has data.
- **Switching user needs a reload.** Pages update themselves through signals when other people decide, but your own identity only changes on reload.

### Faster identity switching

Restarting the whole app per user is slow. Some shortcuts:

- Run the frontend once with `yarn workspace app start`, and restart only the backend (`yarn workspace backend start`) when switching user. A warm backend restart takes seconds.
- Add a local config overlay with `auth.backstageTokenExpiration: { hours: 24 }`. Then, for each user, save the response of `GET http://localhost:7007/api/auth/guest/refresh` (with the header `X-Requested-With: XMLHttpRequest`). Its `backstageIdentity.token` lets you call the API as that person for a day without restarting, and tokens survive restarts on the same database.
- Point `backend.database.connection.directory` at a scratch folder in an overlay to experiment without touching `.local-db`.
- Scheduled jobs can be run on demand, for example the retention sweep:
  `POST /api/scaffolder-approvals/.backstage/scheduler/v1/tasks/scaffolder-approvals-retention/trigger`.

### Work on the approvals page alone

```sh
cd plugins/scaffolder-approvals
yarn start
```

This serves the page against a mock API, with no backend needed. Sign in as a guest and accept the fallback to the legacy guest token. The mock makes whoever signs in an approver and applies the backend's rules, so approving, denying and withdrawing all work; its requests reset on reload. It includes a part-approved request, one to deny, one of your own to withdraw, a running one and a redacted one. A **Home card** page shows the home-page card.

## Check that the gate holds

With the backend running:

```sh
./scripts/verify-gate.sh
```

It checks, against the real scaffolder and catalog, that:

1. the example template is marked gated by the catalog module;
2. invalid values are rejected before anything is stored;
3. a valid request is stored as pending, with its summary rendered and its policy captured;
4. starting the template directly through the scaffolder API fails at the gate, with every later step skipped.

Set `BASE` (default `http://localhost:7007`) and `TEMPLATE` (default `template:default/request-github-admin`) to point it elsewhere. It signs in through the guest provider.

## Tests and checks

```sh
yarn tsc                # type-check everything
yarn lint:all           # lint every package
yarn test:all           # run every package's tests, with coverage
yarn prettier:check     # formatting, including Markdown
yarn build:api-reports  # update the report.api.md files after changing public APIs
```

The backend tests run against SQLite and, when `BACKSTAGE_TEST_DATABASE_POSTGRES18_CONNECTION_STRING` is set, PostgreSQL 18. [CI](.github/workflows/ci.yml) runs formatting, type-check, lint, build and tests on every pull request and on pushes to `main`.

### Documentation

The docs live in [`docs/`](docs), with screenshots in [`docs/images/`](docs/images). When a change affects what people see or do, update the matching page and, if a screen changed, its screenshot. Screenshots are taken from this app at a 1280×800 viewport and 2× scale.

Package READMEs are published to npm, so links in them to anything outside the package use absolute `https://github.com/Ferin79/backstage-scaffolder-approvals/...` URLs.

## Releasing

The six packages are published to npm under `@ferin79` and always share one version.

1. Bump all six, commit, and merge to `main`:

   ```sh
   yarn workspaces foreach -A --no-private version 0.0.2
   ```

2. Tag the merged commit and push the tag:

   ```sh
   git tag v0.0.2
   git push origin v0.0.2
   ```

   The [release workflow](.github/workflows/release.yml) checks that the tag matches every package's version, then type-checks, builds, tests, and stages each package to npm with provenance. A pre-release such as `v0.1.0-next.1` is staged under the `next` dist-tag; anything else under `latest`.

3. **Approve the staged versions.** The workflow's npm token can only stage, so nothing is public until a maintainer approves each version with 2FA, on npmjs.com or from a terminal (npm 11.15 or later):

   ```sh
   npm stage list @ferin79/backstage-plugin-scaffolder-approvals
   npm stage approve <stage-id>
   ```

   Approve all six together. The packages depend on each other at `^<version>`, which for a `0.0.x` version means exactly that version.

Re-running the workflow skips versions already published, but cannot stage a version that is staged and awaiting approval; approve or reject it first.

## Notes

- **Where this came from.** The plugins were built in a fork of [`backstage/community-plugins`](https://github.com/backstage/community-plugins) and moved here with their history. They were written under the `@backstage-community/` scope, which belongs to the Backstage project, and are published as `@ferin79/backstage-plugin-*` instead.
- **`@yarnpkg/core` is pinned to 4.9.1** in the root `package.json`. Version 4.9.2 depends on `got` through a patch file that only exists in yarn's own repository, so a fresh install fails to resolve. Drop the pin once a fixed version is out.
