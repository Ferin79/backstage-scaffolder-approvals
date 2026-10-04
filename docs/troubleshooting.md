# Troubleshooting

Find the symptom, then check the causes in order. Most problems are an installation step that was skipped, or a group membership that is not what you expect.

- [Installing](#installing)
- [Templates](#templates)
- [Requesting](#requesting)
- [Approving](#approving)
- [After approval](#after-approval)
- [Notifications and live updates](#notifications-and-live-updates)
- [Permissions](#permissions)
- [FAQ](#faq)

## Installing

### The backend will not start: an error names `scaffolderApprovals.grantTtl` or `retention.redactAfter`

The duration is invalid: a misspelt unit (`{ hour: 1 }` instead of `{ hours: 1 }`), a bare number, or zero. Fix the value; see [Durations](configuration.md#durations). This check is deliberate, because a duration read as zero would break every approval.

### I changed `grantTtl` or `redactAfter`, but the old value still applies

Backstage merges config objects key by key across config files. `redactAfter: { hours: 12 }` in an override file, on top of `{ days: 180 }` in `app-config.yaml`, means 180 days and 12 hours. Use the string form in overrides, such as `redactAfter: '12h'`; see [Durations](configuration.md#durations).

### The approvals page looks unstyled, or its font differs from the rest of the app

The page is built with Backstage UI. Import `@backstage/ui/css/styles.css` in `packages/app/src/index.tsx`, and to match an MUI theme's font, add the stylesheet in [Check the stylesheet and font](getting-started.md#36-check-the-stylesheet-and-font).

### There is no "Approvals" item in the sidebar

In the legacy frontend system, the sidebar item is added by hand; see [Add a sidebar item](getting-started.md#32-add-a-sidebar-item). In the new frontend system it appears by itself once the plugin is installed.

## Templates

### A gated template does not appear in the catalog or on the Create page

1. **The catalog does not know the `Template` kind.** Add `@backstage/plugin-catalog-backend-module-scaffolder-entity-model` to the backend. Without it, templates are dropped **silently**.
2. **The catalog location does not allow templates.** A location in `app-config.yaml` needs `rules: [{ allow: [Template] }]`, or `Template` in the global `catalog.rules`.
3. **The catalog has not processed it yet.** Wait a minute, or check the catalog's logs for errors about the file.

### The template is not marked gated: no "Approver" link, and the button says Create

1. **The catalog module is missing.** Add `@ferin79/backstage-plugin-catalog-backend-module-approvals` to the backend that runs the catalog. It sets the `scaffolder-approvals.backstage.io/gated` annotation.
2. **The catalog has not reprocessed the template** since the gate was added. Wait for the next refresh, or refresh the entity from its catalog page.
3. **The frontend pieces are missing.** The "Approver" link comes from [`GatedTemplateCard`](getting-started.md#34-show-approvers-on-the-create-page), and the **Request approval** button from [`GatedReviewStep`](getting-started.md#33-let-requesters-submit-from-the-scaffolder). Both need the legacy frontend system.

### The card says "Needs approval" without naming approvers, and the wizard says the gate is unusable

The template breaks one of the [rules for gated templates](writing-gated-templates.md#rules-a-gated-template-must-follow). The wizard's last step says which, and the catalog logs a warning starting `<template ref> has an unusable gate`. Common causes:

- `values: ${{ parameters }}` is missing or narrowed to one field;
- the gate is not the first step, or there are two gates;
- `approvers` uses a template expression, or a ref without its kind (`devx-team` instead of `group:default/devx-team`);
- the template has a `ui:field: Secret` parameter.

### The catalog logs "is gated but a later step reads '${{ user.* }}'" or "uses secrets.USER_OAUTH_TOKEN"

The template will run, but those references will be empty or expired in an approved run. Use `${{ steps.gate.output.requestedBy }}` and the backend's integration credentials instead; see [What an approved run can and cannot see](writing-gated-templates.md#what-an-approved-run-can-and-cannot-see).

## Requesting

### Pressing Create gives a failed task: "This template requires approval before it can run"

The template is gated, so it cannot be started directly, but the app is not showing the approvals review step. Either:

- the app has not installed [`GatedReviewStep`](getting-started.md#33-let-requesters-submit-from-the-scaffolder) as the scaffolder's `ReviewStepComponent`; or
- the app uses the new frontend system, which has no way to install it ([details](getting-started.md#new-frontend-system)).

The gate did its job: nothing after it ran.

### Submitting fails with a message about the values

The values do not satisfy the template's parameter schema, for example a required field is missing or text is too short. The backend checks this at submit, so approvers never see a request that could not run. Go back in the wizard and correct the field the message names.

### Submitting again took me to my old request

That is intended. If you already have a pending request for the same template with the same values, it is returned instead of creating a duplicate that approvers would see twice.

## Approving

### "You are not an approver for this request", but I am in the approver group

1. **You are in a group _inside_ the approver group.** Only direct members count, because Backstage puts a user's direct groups in their token. Ask the template's owners to name your group, or use a sign-in resolver that adds parent groups. See [Choosing approvers](writing-gated-templates.md#choosing-approvers).
2. **You were added recently.** Your groups are read when you sign in. Sign out and back in.
3. **You signed in before the catalog had loaded your user.** This happens right after a fresh start. Sign out and back in once the catalog has your user and groups.
4. **The template names a different group**, or a group in another namespace. The request page names the approver groups; select one to check its members.

To see which groups your token carries, open the browser's developer tools, find the response of `/api/auth/<provider>/refresh` in the Network tab (it is sent on page load), and look at `backstageIdentity.identity.ownershipEntityRefs`. The groups listed there are the ones approvals are matched against.

### "You cannot approve your own request"

The template does not allow self-approval (`selfApprove` defaults to `false`). Another approver must decide. If the requester is one of only two members and the quorum is 2, it can never be met; ask the template's owners to lower the quorum or add approvers.

### My inbox is empty, but I know there are pending requests

**Waiting on you** shows only requests you can act on now. It leaves out:

- requests you submitted (unless self-approval is allowed);
- requests you have already approved or denied;
- requests whose approvers do not include you or a group you are directly in.

The request page always explains why you cannot act on a particular request.

## After approval

### The request has been "Starting" for a while

The quorum was met, and the backend is trying to start the template.

1. **The scaffolder is down or unreachable.** The backend retries every two minutes until the approval expires (one hour by default, [`grantTtl`](configuration.md#grantttl-how-long-an-approval-stays-usable)). If it is still not running by then, the request fails with "the approval grant expired before the template could start".
2. **Check the backend logs** for errors from the scaffolder.

### The request still says "Running" after the task finished

The events backend is not installed, so the task's completion arrives on the next reconciliation run instead, within two minutes. Install `@backstage/plugin-events-backend` for immediate updates.

### The approved run failed at "Await approval": "The approval for this run was rejected"

The gate could not redeem the approval. The backend logs `Refused an approval grant for request <id>`. Possible causes:

| Cause                                                                                 | Fix                                                                         |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| The task was **recovered or retried** after a restart, and the grant was already used | Do not use `EXPERIMENTAL_recovery` on gated templates. Resubmit the request |
| The grant **expired** before the gate ran                                             | Very rare; if the scaffolder queues tasks for a long time, raise `grantTtl` |
| The parameters the task ran with do not match the approved ones                       | Make sure the gate's input is exactly `values: ${{ parameters }}`           |

If the backend instead logs `Refused an approval grant redemption from '<subject>'`, the scaffolder presents a different service identity, which happens in split deployments. Add that subject to [`grantConsumers`](configuration.md#grantconsumers-split-deployments).

### The approved run failed: "Could not reach the approvals backend to redeem the grant"

The scaffolder could not reach the approvals backend through discovery. In a split deployment, make sure the scaffolder's backend can resolve `scaffolder-approvals` (for example with `discovery.endpoints`). The gate fails rather than letting an unchecked run through.

### "the scaffolder refused to start the template (…)"

The scaffolder rejected the launch, and its own message follows. Typical reasons:

- the template's **parameters changed** while the request waited, and the values no longer fit (approvers are warned about this on the request page);
- the template was **deleted**.

The scaffolder would refuse the same launch again, so the request fails straight away. Fix the cause, then press **Resubmit**.

### `${{ user.entity.metadata.name }}` is empty in an approved run

Expected: the run belongs to the approvals plugin, not the requester. Use `${{ steps.gate.output.requestedBy }}`.

### The approved task does not appear under "My tasks" in the scaffolder

Expected, for the same reason: the task has no `createdBy`. Follow it from the approvals page, which links to the task.

### A dry run of a gated template fails at the gate

Expected: a dry run has no approval. Test the later steps in an ungated copy of the template.

## Notifications and live updates

### Nobody gets notifications

1. Install `@backstage/plugin-notifications-backend` in the backend, and the notifications page and sidebar item in the frontend.
2. Check that approvers are real catalog users, or groups with members. Notifications to a group go to its members.
3. Check the backend logs for `Could not deliver an approvals notification`.

The requester is never notified about their own new request; that is intended.

### Notification links lead to a "page not found"

The approvals page is not mounted at `/scaffolder-approvals`. Links are built as `<app.baseUrl>/scaffolder-approvals/requests/<id>`. Mount it there, and check that `app.baseUrl` is the URL people use.

### Pages do not update until I reload

Install the signals plugin: `@backstage/plugin-signals-backend` in the backend, and `SignalsDisplay` from `@backstage/plugin-signals` in the app's root (legacy frontend system). The pages work without it, but only show what they loaded.

## Permissions

### My permission policy has no effect

Set `permission.enabled: true` in `app-config.yaml`. Without it, every permission is allowed and no policy runs. The gate's own rules still apply.

### Listing requests returns 403: "conditional read policy … is not supported yet"

Your policy returns a conditional decision for `scaffolderApprovals.request.read`. Return a plain ALLOW or DENY for reads; see [Permissions](security-model.md#permissions).

### I allowed someone to decide through a policy, but they still cannot approve

A policy can only **narrow** who may decide; it cannot make someone an approver. Add them, or their group, to the template's `approvers`. See [Break-glass](security-model.md#break-glass).

## FAQ

**Can the gate go in the middle of a template?**
No. It must be the first step. Pausing a running task needs a suspend/resume feature in Backstage core ([BEP-0016](https://github.com/backstage/backstage/pull/34966)).

**Can approvers depend on the form, such as "the owner of the chosen system"?**
No. Approvers are read from the template before anyone fills in the form, so they must be fixed refs. Use a group per area and separate templates if needed.

**Can an approved request be run again?**
No. An approval unlocks exactly one run. Submit a new request; on a failed one, **Resubmit** does that with the same values.

**Can an approver change their mind?**
No. Decisions are final and kept for the audit trail. A requester can withdraw a request that is still pending.

**Where is the audit trail?**
In the approvals database (requests and decisions, kept indefinitely), in Backstage audit events, and in each task's log. See [Audit trail](security-model.md#audit-trail).

**Does it work with the new frontend system?**
Partly: the approvals page and home-page widget do; the gated review step and template card do not. See [New frontend system](getting-started.md#new-frontend-system).

**Who can see requests and their values?**
Every signed-in user, like the scaffolder's task list. You can deny `scaffolderApprovals.request.read` to restrict it. Values are redacted after the retention window.

## Still stuck?

Open an issue at [github.com/Ferin79/backstage-scaffolder-approvals/issues](https://github.com/Ferin79/backstage-scaffolder-approvals/issues) with the Backstage version, which frontend system you use, the request's status and failure reason, and any backend log lines mentioning `scaffolder-approvals`.
