import { GlFeatureGate as GlFeatureGateWC } from '../feature-gate';
import { reactWrapper } from '../helpers/react-wrapper';

export interface GlFeatureBadge extends GlFeatureGateWC {}
export const GlFeatureGate = reactWrapper(GlFeatureGateWC, { tagName: 'gl-feature-gate' });
