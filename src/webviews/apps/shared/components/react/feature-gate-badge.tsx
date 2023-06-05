import { FeatureGateBadge as featureGateBadgeComponent } from '../feature-gate-badge';
import { reactWrapper } from '../helpers/react-wrapper';

export const FeatureGateBadge = reactWrapper(featureGateBadgeComponent, {
	name: 'gk-feature-gate-badge',
	properties: ['placement', 'subscription'],
});
