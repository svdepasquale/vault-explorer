import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

const TIP_ID = 'recall-tip';

interface ActiveTip {
  key: string;
  rect: DOMRect;
  content: ReactNode;
}

interface TipApi {
  active: string | null;
  show: (key: string, anchor: HTMLElement, content: ReactNode) => void;
  hide: (key: string) => void;
}

const TipContext = createContext<TipApi | null>(null);

/**
 * Explanations on hover and keyboard focus: one fixed-position tooltip,
 * portalled to <body> so the scrolling view never clips it. Scroll, resize
 * and Escape dismiss it.
 */
export function TipLayer({ children }: { children: ReactNode }) {
  const [tip, setTip] = useState<ActiveTip | null>(null);
  const show = useCallback((key: string, anchor: HTMLElement, content: ReactNode) => {
    setTip({ key, rect: anchor.getBoundingClientRect(), content });
  }, []);
  const hide = useCallback((key: string) => setTip((t) => (t?.key === key ? null : t)), []);
  const open = tip !== null;

  useEffect(() => {
    if (!open) return;
    const clear = (): void => setTip(null);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      // Capture phase: dismiss the tooltip without also closing the page panel.
      e.preventDefault();
      clear();
    };
    window.addEventListener('scroll', clear, true);
    window.addEventListener('resize', clear);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('scroll', clear, true);
      window.removeEventListener('resize', clear);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const api = useMemo<TipApi>(() => ({ active: tip?.key ?? null, show, hide }), [tip, show, hide]);
  return (
    <TipContext.Provider value={api}>
      {children}
      {tip && createPortal(<TipBox tip={tip} />, document.body)}
    </TipContext.Provider>
  );
}

function TipBox({ tip }: { tip: ActiveTip }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    const { width, height } = box.getBoundingClientRect();
    const gap = 6;
    const margin = 8;
    const left = Math.max(margin, Math.min(tip.rect.left, window.innerWidth - width - margin));
    const below = tip.rect.bottom + gap;
    const top = below + height > window.innerHeight - margin ? Math.max(margin, tip.rect.top - gap - height) : below;
    setPosition({ left, top });
  }, [tip]);

  return (
    <div ref={ref} id={TIP_ID} role="tooltip" className="recall-tip" style={position ?? { left: 0, top: 0, visibility: 'hidden' }}>
      {tip.content}
    </div>
  );
}

/** Props that make an element show `content` on hover and focus. */
export function useTip(key: string, content: () => ReactNode) {
  const ctx = useContext(TipContext);
  return {
    tabIndex: 0,
    'aria-describedby': ctx?.active === key ? TIP_ID : undefined,
    onPointerEnter: (e: PointerEvent<HTMLElement>) => ctx?.show(key, e.currentTarget, content()),
    onPointerLeave: () => ctx?.hide(key),
    onFocus: (e: FocusEvent<HTMLElement>) => ctx?.show(key, e.currentTarget, content()),
    onBlur: () => ctx?.hide(key),
  };
}
