import type { EventName } from '@lit/react';
import { reactWrapper } from '../../../shared/components/helpers/react-wrapper';
import type { GraphMinimapDaySelectedEventDetail } from './minimap';
import { GraphMinimap as GraphMinimapWC } from './minimap';

export interface GraphMinimap extends GraphMinimapWC {}
export const GraphMinimap = reactWrapper(GraphMinimapWC, {
	tagName: 'graph-minimap',
	events: {
		onSelected: 'selected' as EventName<CustomEvent<GraphMinimapDaySelectedEventDetail>>,
	},
});
