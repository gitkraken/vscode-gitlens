import { reactWrapper } from '../../shared/components/helpers/react-wrapper';
import { ActivityGraph as activityGraphComponent } from './activity-graph';

export const ActivityGraph = reactWrapper(activityGraphComponent, {
	events: {
		onSelected: 'selected',
	},
});
