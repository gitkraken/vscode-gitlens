import type { EventName } from '@lit/react';
import { reactWrapper } from '../../../shared/components/helpers/react-wrapper';
import type { GraphMinimapDaySelectedEventDetail } from './minimap';
import { GraphMinimap as graphMinimapComponent } from './minimap';

export const GraphMinimap = reactWrapper(graphMinimapComponent, {
	tagName: 'graph-minimap',
	events: {
		onSelected: 'selected' as EventName<CustomEvent<GraphMinimapDaySelectedEventDetail>>,
	},
});
