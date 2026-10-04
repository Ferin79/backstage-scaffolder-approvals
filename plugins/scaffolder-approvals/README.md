# @ferin79/backstage-plugin-scaffolder-approvals

The frontend for [Scaffolder Approvals](https://github.com/Ferin79/backstage-scaffolder-approvals): approval gates for Backstage software templates.

It gives requesters and approvers an approvals inbox, a list of their own requests, a page per request, a home-page card, and the scaffolder pieces that let a gated template end in **Request approval** instead of **Create**.

![A request page](https://raw.githubusercontent.com/Ferin79/backstage-scaffolder-approvals/main/docs/images/request-completed.png)

This package needs the backend packages too. The [getting started guide](https://github.com/Ferin79/backstage-scaffolder-approvals/blob/main/docs/getting-started.md) installs everything in order.

## Features

| Feature             | Export                               | Where it appears                                                                    |
| ------------------- | ------------------------------------ | ----------------------------------------------------------------------------------- |
| Approvals page      | `ApprovalsIndexPage`                 | `/scaffolder-approvals`: **Waiting on you**, **Your requests**, and `/requests/:id` |
| Gated review step   | `GatedReviewStep`                    | The scaffolder wizard's last step, for gated templates                              |
| Gated template card | `GatedTemplateCard`                  | The **Create…** page, naming each gated template's approvers                        |
| Home-page card      | `PendingApprovalsHomePageCard`       | The home page: how many requests are waiting on you                                 |
| Standalone card     | `PendingApprovalsCard`               | Anywhere else you want the same card                                                |
| Status badge        | `StatusPill`                         | Your own components                                                                 |
| API client          | `approvalsApiRef`, `ApprovalsClient` | Your own components                                                                 |

## Installation

```sh
yarn --cwd packages/app add @ferin79/backstage-plugin-scaffolder-approvals
```

### Legacy frontend system

**1. Mount the page** at `/scaffolder-approvals`. Notification links assume this path.

```tsx
// packages/app/src/App.tsx
import { ApprovalsIndexPage } from '@ferin79/backstage-plugin-scaffolder-approvals';

<Route path="/scaffolder-approvals" element={<ApprovalsIndexPage />} />;
```

**2. Add a sidebar item:**

```tsx
// packages/app/src/components/Root/Root.tsx
import ApprovalsIcon from '@material-ui/icons/AssignmentTurnedIn';

<SidebarItem icon={ApprovalsIcon} to="scaffolder-approvals" text="Approvals" />;
```

**3. Install the review step and template card** on the scaffolder page. `ReviewStep` is a complete review step wrapped in `GatedReviewStep`; copy it from the [getting started guide](https://github.com/Ferin79/backstage-scaffolder-approvals/blob/main/docs/getting-started.md#33-let-requesters-submit-from-the-scaffolder).

```tsx
// packages/app/src/App.tsx
import { GatedTemplateCard } from '@ferin79/backstage-plugin-scaffolder-approvals';
import { ReviewStep } from './components/scaffolder/ReviewStep';

<Route
  path="/create"
  element={
    <ScaffolderPage
      components={{
        ReviewStepComponent: ReviewStep,
        TemplateCardComponent: GatedTemplateCard,
      }}
    />
  }
/>;
```

**4. Add the home-page card** (optional):

```tsx
import { PendingApprovalsHomePageCard } from '@ferin79/backstage-plugin-scaffolder-approvals';

<PendingApprovalsHomePageCard />;
```

**5. Load Backstage UI's stylesheet**, if your app does not already:

```tsx
// packages/app/src/index.tsx
import '@backstage/ui/css/styles.css';
```

### New frontend system

```ts
// packages/app/src/App.tsx
import approvalsPlugin from '@ferin79/backstage-plugin-scaffolder-approvals/alpha';

export default createApp({ features: [approvalsPlugin] });
```

This adds the approvals page with its own **Approvals** nav item, and an **Approvals** home-page widget. The gated review step and template card are not available in the new frontend system, because its scaffolder page has no slot for a custom review step (Backstage 1.55). Requesters there get a failed task telling them the template needs approval; the gate itself still holds.

## Components

### `GatedReviewStep`

Replaces the wizard's last step for gated templates: it shows who will be asked and submits an approval request. For every other template it renders its `children` untouched.

| Prop          | Type              | Description                                                                                                                     |
| ------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `...props`    | `ReviewStepProps` | The props the scaffolder passes to a review step                                                                                |
| `children`    | `ReactNode`       | **Required.** Your complete review step (values table plus Back and Create), used for ungated templates                         |
| `templateRef` | `string`          | The template being reviewed. Read from the scaffolder's route when omitted; pass it if you mount the wizard at a different path |

![The gated review step](https://raw.githubusercontent.com/Ferin79/backstage-scaffolder-approvals/main/docs/images/wizard-review-step.png)

### `GatedTemplateCard`

The scaffolder's own template card, plus an "Approver: …" link per approver on gated templates. Use it as `TemplateCardComponent`.

| Prop              | Type                                                   | Description                              |
| ----------------- | ------------------------------------------------------ | ---------------------------------------- |
| `template`        | `TemplateEntityV1beta3`                                | The template to show                     |
| `additionalLinks` | `{ icon: IconComponent; text: string; url: string }[]` | Extra links, such as "View TechDocs"     |
| `onSelected`      | `(template: TemplateEntityV1beta3) => void`            | Called when someone chooses the template |

A template whose gate the backend would refuse shows **Needs approval** without approvers, and the review step explains what is wrong.

### `PendingApprovalsHomePageCard` and `PendingApprovalsCard`

How many requests are waiting on the signed-in user, with a link to the inbox. `PendingApprovalsHomePageCard` is a [home plugin](https://backstage.io/docs/getting-started/homepage) card extension; `PendingApprovalsCard` is the same card as a plain component.

![The home-page card](https://raw.githubusercontent.com/Ferin79/backstage-scaffolder-approvals/main/docs/images/home-page-card.png)

### `StatusPill`

A request status as a coloured badge with a dot, labelled for people: `pending` shows as "Awaiting approval", `approved` as "Starting", `rejected` as "Denied", `cancelled` as "Withdrawn".

| Prop     | Type                    |
| -------- | ----------------------- |
| `status` | `ApprovalRequestStatus` |

### `approvalsApiRef`

A client for the approvals backend, registered by the plugin:

```ts
const approvals = useApi(approvalsApiRef);
const inbox = await approvals.listRequests({
  role: 'approver',
  actionable: true,
});
```

Methods: `listRequests`, `getRequest`, `submitRequest`, `decide`, `cancel`. See the [API reference](https://github.com/Ferin79/backstage-scaffolder-approvals/blob/main/docs/api-reference.md).

### Routes

`rootRouteRef` (the approvals page) and `requestRouteRef` (one request, with a `requestId` parameter) are exported for linking from other plugins. `Router` is exported for apps that mount the page themselves.

## Live updates

With the [signals plugin](https://backstage.io/docs/notifications/#optional-add-signals) installed, the request page, the inbox and the home-page card refresh themselves when anything changes. Without it, they show what they loaded until reloaded.

## Development

```sh
yarn start
```

Serves the plugin against a mock API with a part-approved request, one to deny, one of your own to withdraw, a running one and a redacted one. No backend needed.

## Documentation

- [Getting started](https://github.com/Ferin79/backstage-scaffolder-approvals/blob/main/docs/getting-started.md)
- [User guide](https://github.com/Ferin79/backstage-scaffolder-approvals/blob/main/docs/user-guide.md)
- [Troubleshooting](https://github.com/Ferin79/backstage-scaffolder-approvals/blob/main/docs/troubleshooting.md)
- [All documentation](https://github.com/Ferin79/backstage-scaffolder-approvals/blob/main/docs/README.md)
