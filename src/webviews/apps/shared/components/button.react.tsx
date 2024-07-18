import { GlButton as GlButtonWC } from './button';
import { reactWrapper } from './helpers/react-wrapper';

export interface GlButton extends GlButtonWC {}
export const GlButton = reactWrapper(GlButtonWC, { tagName: 'gl-button' });
