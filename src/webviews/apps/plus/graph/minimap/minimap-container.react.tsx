import type { EventName } from '@lit/react';
import type { CustomEventType } from '../../../shared/components/element';
import { reactWrapper } from '../../../shared/components/helpers/react-wrapper';
import { GlGraphMinimapContainer as GlGraphMinimapContainerWC } from './minimap-container';

export interface GlGraphMinimapContainer extends GlGraphMinimapContainerWC {}
export const GlGraphMinimapContainer = reactWrapper(GlGraphMinimapContainerWC, {
	tagName: 'gl-graph-minimap-container',
	events: {
		onSelected: 'gl-graph-minimap-selected' as EventName<CustomEventType<'gl-graph-minimap-selected'>>,
	},
});
