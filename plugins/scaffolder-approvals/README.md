# @ferin79/backstage-plugin-scaffolder-approvals

The approvals inbox, your own requests, and one request in detail.

This is the canonical view of a gated run — not the scaffolder's task page. A gated template is launched by the approvals backend's service principal, so the task records this plugin as its author rather than the person who asked for it. Who asked and who agreed lives here.

## Installation

The plugin dual-ships, so install it whichever way your app is wired.

### New frontend system

```ts
// packages/app/src/App.tsx
import approvalsPlugin from '@ferin79/backstage-plugin-scaffolder-approvals/alpha';

export const app = createApp({ features: [approvalsPlugin] });
```

### Legacy frontend system

```tsx
// packages/app/src/App.tsx
import { ApprovalsIndexPage } from '@ferin79/backstage-plugin-scaffolder-approvals';

<Route path="/scaffolder-approvals" element={<ApprovalsIndexPage />} />;
```

Add a sidebar link to `/scaffolder-approvals` so approvers can find their inbox.

Both entrypoints mount the same components; only the wiring differs.

## What you get

| Page                                                   | What it answers                                        |
| ------------------------------------------------------ | ------------------------------------------------------ |
| **Waiting on you** — `/scaffolder-approvals`           | Which requests can I decide on right now?              |
| **Your requests** — `/scaffolder-approvals/mine`       | What happened to the things I asked for?               |
| **One request** — `/scaffolder-approvals/requests/:id` | Who asked, what for, who has agreed, and what I can do |

The inbox lists only pending requests — somebody looking for work does not want a history of everything they ever approved. Your own requests list every status, because "it failed" is often the answer you need.

The pages are built from [Backstage UI](https://ui.backstage.io): BUI's plugin header names the plugin and carries the two lists as tabs, and a request page puts where it stands — and the approve, deny, withdraw or resubmit buttons — in one panel at the top, above its parameters, its activity and its details. The plugin draws that header itself in both frontend systems, so the new-system page is registered with `noHeader`.

## Notes

- **The decide buttons and the backend agree by construction.** Both use `checkDecisionEligibility` from the common package, so a disabled control and a server refusal give the same reason: you are not an approver, you cannot approve your own request, you have already decided, or it has already been decided.
- **A redacted request renders as an explanation, not a blank.** After the retention window the submitted values and summary are gone, but the request and its decision history remain — that is the audit trail the feature exists to produce.
- **Status labels are written for people, not for the state machine.** `approved` shows as "Starting", because it is a transient state and a requester seeing "Approved" with nothing happening would reasonably be confused.
- **The status pill is BUI's `Badge`, tinted.** `Badge` has no colour variants, so the pill adds a tint from BUI's status colour variables, which is also what makes it correct in both themes. It carries a dot as well as colour, so status does not depend on colour alone.

## Development

```sh
yarn start
```

The dev harness serves the plugin against a mock API with a part-way-approved request, one to deny, one of your own to withdraw, a running one, and a redacted one — the states that are otherwise awkward to eyeball.

## Documentation

- [Design and decision record](../../docs/GATED_SCAFFOLDER_WORKFLOWS.md)
- [Implementation guide](../../docs/GATED_SCAFFOLDER_IMPLEMENTATION.md)
- [Plugin guide](../../docs/README.md)
