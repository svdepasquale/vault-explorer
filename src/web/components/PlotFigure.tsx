import * as Plot from '@observablehq/plot';
import { useEffect, useRef } from 'react';

export interface PlotFigureProps {
  /** Plot options; rebuild happens whenever this object changes identity — memoize it. */
  options: Plot.PlotOptions;
  /** Called with the datum under the pointer on click (requires a `tip`/pointer mark). */
  onSelect?: (datum: unknown) => void;
  className?: string;
}

/**
 * Observable Plot inside React. Axis and text use `currentColor`, so the chart
 * inherits the theme ink from CSS; pass palette colors for marks explicitly.
 */
export function PlotFigure({ options, onSelect, className }: PlotFigureProps) {
  const ref = useRef<HTMLDivElement>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    const figure = Plot.plot({
      ...options,
      style: { background: 'transparent', color: 'var(--ink-2)', fontFamily: 'var(--font-sans)', fontSize: '12px', ...(typeof options.style === 'object' ? options.style : {}) },
    });
    const onClick = (): void => {
      const value = (figure as unknown as { value?: unknown }).value;
      if (value !== undefined && value !== null) onSelectRef.current?.(value);
    };
    figure.addEventListener('click', onClick);
    host.replaceChildren(figure);
    return () => {
      figure.removeEventListener('click', onClick);
      figure.remove();
    };
  }, [options]);

  return <div ref={ref} className={`plot-figure${className ? ` ${className}` : ''}`} />;
}
