import { reactWrapper } from '../helpers/react-wrapper';
import { GlIndicator as GlIndicatorWC, tagName } from './indicator';

export const GlIndicator = reactWrapper(GlIndicatorWC, { tagName: tagName });
