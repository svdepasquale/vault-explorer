import type { ReactNode } from 'react';
import { useDerived } from '../app/derived.ts';
import { shortLabel } from '../app/format.ts';
import { useStore } from '../app/store.ts';
import { KindDot } from './KindBadge.tsx';

/** Clickable reference to a page: selects it and opens the page panel. */
export function PageLink({ id, children, showKind = true }: { id: string; children?: ReactNode; showKind?: boolean }) {
  const derived = useDerived();
  const select = useStore((s) => s.select);
  const page = derived?.pageById.get(id);
  if (!page) {
    return <span className="page-link missing">{children ?? shortLabel(id)}</span>;
  }
  return (
    <button type="button" className="page-link" onClick={() => select(id)} title={page.title}>
      {showKind && <KindDot kind={page.kind} />}
      <span className="page-link-text">{children ?? shortLabel(id)}</span>
    </button>
  );
}
