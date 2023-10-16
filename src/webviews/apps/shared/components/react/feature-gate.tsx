import { FeatureGate as featureGateComponent } from '../feature-gate';
import { reactWrapper } from '../helpers/react-wrapper';

export const FeatureGate = reactWrapper(featureGateComponent, { tagName: 'gk-feature-gate' });
