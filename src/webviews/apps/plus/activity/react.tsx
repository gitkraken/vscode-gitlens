import { reactWrapper } from '../../shared/components/helpers/react-wrapper';
import { ActivityMinibar as activityMinibarComponent } from './activity-minibar';

export const ActivityMinibar = reactWrapper(activityMinibarComponent, {
	events: {
		onSelected: 'selected',
	},
});
