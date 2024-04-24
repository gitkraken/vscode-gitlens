import { GlFeatureBadge as GlFeatureBadgeWC } from '../feature-badge';
import { reactWrapper } from '../helpers/react-wrapper';

export interface GlFeatureBadge extends GlFeatureBadgeWC {}
export const GlFeatureBadge = reactWrapper(GlFeatureBadgeWC, { tagName: 'gl-feature-badge' });
