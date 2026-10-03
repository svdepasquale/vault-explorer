import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { ViewId } from '../app/store.ts';

// Each view owns its folder under src/web/views/<id>/ and default-exports its
// root component; views are code-split so the graph stays the first paint.
export const VIEW_COMPONENTS: Record<ViewId, LazyExoticComponent<ComponentType>> = {
  graph: lazy(() => import('./graph/GraphView.tsx')),
  timeline: lazy(() => import('./timeline/TimelineView.tsx')),
  overview: lazy(() => import('./overview/OverviewView.tsx')),
  health: lazy(() => import('./health/HealthView.tsx')),
  recall: lazy(() => import('./recall/RecallView.tsx')),
};
