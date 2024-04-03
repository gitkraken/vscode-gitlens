import { reactWrapper } from '../helpers/react-wrapper';
import { Tooltip } from './tooltip';

export const GlTooltip = reactWrapper(Tooltip, { tagName: 'gl-tooltip' });
