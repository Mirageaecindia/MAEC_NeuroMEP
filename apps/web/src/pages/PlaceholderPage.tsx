import { useParams } from 'react-router';
import { AppShell, PAGES } from '../layout/AppShell';

/** Pages 2-5 are built in later tasks. */
export function PlaceholderPage(props: { pageKey: (typeof PAGES)[number]['key'] }) {
  const { projectId } = useParams();
  const page = PAGES.find((p) => p.key === props.pageKey)!;
  return (
    <AppShell projectId={projectId}>
      <div className="page-header">
        <h1>{page.title}</h1>
        <p>This page is not built yet.</p>
      </div>
    </AppShell>
  );
}
