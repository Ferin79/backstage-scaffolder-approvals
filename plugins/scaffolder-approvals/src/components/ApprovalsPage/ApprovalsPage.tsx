import { useApi } from '@backstage/core-plugin-api';
import { Container, Header } from '@backstage/ui';
import { approvalsApiRef } from '../../api';
import { ApprovalsLayout } from '../ApprovalsLayout';
import { INBOX_QUERY, type RequestsQuery } from '../queries';
import { RequestsTable } from './RequestsTable';

/** @public */
export interface ApprovalsPageProps {
  /**
   * Which list to show: what is waiting on you, or what you asked for.
   * Defaults to the inbox.
   */
  view?: 'inbox' | 'mine';
}

const VIEWS: Record<
  NonNullable<ApprovalsPageProps['view']>,
  {
    documentTitle: string;
    title: string;
    description: string;
    query: RequestsQuery;
    emptyTitle: string;
    emptyDescription: string;
  }
> = {
  inbox: {
    documentTitle: 'Approvals',
    title: 'Waiting on you',
    description:
      'Requests to run a template that you can approve or deny. A template runs only once enough approvers agree.',
    query: INBOX_QUERY,
    emptyTitle: 'Nothing is waiting on you',
    emptyDescription: 'Requests you can decide on will appear here.',
  },
  mine: {
    documentTitle: 'Your requests',
    title: 'Your requests',
    description:
      'Gated templates you have submitted, and what happened to each of them.',
    // Everything, because "what happened to the thing I asked for" is the
    // question, and the answer is often that it failed.
    query: { role: 'requester' },
    emptyTitle: 'You have not asked for anything yet',
    emptyDescription:
      'Gated templates you submit will appear here with their progress.',
  },
};

/**
 * The approvals page: what is waiting on you, and what you asked for.
 *
 * Two lists rather than one filtered table, because they answer different
 * questions and belong to different people. An approver opens this to find work
 * to do; a requester opens it to find out what happened. Each is a tab in the
 * plugin header, with an address of its own.
 *
 * @public
 */
export function ApprovalsPage(props: ApprovalsPageProps) {
  const { view = 'inbox' } = props;
  const api = useApi(approvalsApiRef);
  const { documentTitle, title, description, ...table } = VIEWS[view];

  return (
    <ApprovalsLayout title={documentTitle}>
      <Header title={title} description={description} />
      <Container>
        <RequestsTable
          // Keyed, so switching tabs starts the table over rather than
          // carrying one list's page and sort into the other.
          key={view}
          api={api}
          {...table}
        />
      </Container>
    </ApprovalsLayout>
  );
}
