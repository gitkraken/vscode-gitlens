import { reactWrapper } from '../helpers/react-wrapper';
import { GlTooltip as GlTooltipWC } from './tooltip';

export interface GlTooltip extends GlTooltipWC {}
export const GlTooltip = reactWrapper(GlTooltipWC, { tagName: 'gl-tooltip' });
