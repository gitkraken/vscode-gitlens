import { reactWrapper } from '../helpers/react-wrapper';
import { GlPopover as GlPopoverWC } from './popover';

export interface GlPopover extends GlPopoverWC {}
export const GlPopover = reactWrapper(GlPopoverWC, { tagName: 'gl-popover' });
