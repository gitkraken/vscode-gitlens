import { reactWrapper } from '../../../shared/components/helpers/react-wrapper';
import { GraphMinimap as graphMinimapComponent } from './minimap';

export const GraphMinimap = reactWrapper(graphMinimapComponent, {
	events: {
		onSelected: 'selected',
	},
});
