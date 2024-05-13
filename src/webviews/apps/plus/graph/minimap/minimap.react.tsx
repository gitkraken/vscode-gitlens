import type { EventName } from '@lit/react';
import type { CustomEventType } from '../../../shared/components/element';
import { reactWrapper } from '../../../shared/components/helpers/react-wrapper';
import { GlGraphMinimap as GlGraphMinimapWC } from './minimap';

export interface GlGraphMinimap extends GlGraphMinimapWC {}
export const GlGraphMinimap = reactWrapper(GlGraphMinimapWC, {
	tagName: 'gl-graph-minimap',
	events: {
		onSelected: 'gl-graph-minimap-selected' as EventName<CustomEventType<'gl-graph-minimap-selected'>>,
	},
});
