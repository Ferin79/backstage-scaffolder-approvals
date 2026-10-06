/**
 * The home-page card's parts, loaded on demand, for both plugin entrypoints.
 *
 * The card's own module rather than the components barrel: the barrel also
 * carries the wizard's review step, and with it the scaffolder's form and
 * review code, none of which a home page needs to load.
 *
 * The extensions draw their own card around `Content`, so the way to the
 * approvals page has to be handed over as `Actions`, or the home page has
 * none.
 */
export const loadPendingApprovalsCard = () =>
  import('./components/PendingApprovalsCard').then(m => ({
    Content: m.PendingApprovalsContent,
    Actions: m.PendingApprovalsActions,
  }));
