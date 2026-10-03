import { KIND_LABELS, type PageKind } from '../../shared/model.ts';

/** Color dot + kind name: identity is never carried by color alone. */
export function KindBadge({ kind, compact = false }: { kind: PageKind; compact?: boolean }) {
  return (
    <span className={`kind-badge kind-${kind}`} title={KIND_LABELS[kind]}>
      <span className="kind-dot" aria-hidden="true" />
      {!compact && <span className="kind-name">{KIND_LABELS[kind]}</span>}
    </span>
  );
}

export function KindDot({ kind }: { kind: PageKind }) {
  return <span className={`kind-dot kind-${kind}`} role="img" aria-label={KIND_LABELS[kind]} title={KIND_LABELS[kind]} />;
}
