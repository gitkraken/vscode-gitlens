import { reactWrapper } from '../helpers/react-wrapper';
import { GlConnect as GlConnectWC } from './connect';

export interface GlConnect extends GlConnectWC {}
export const GlConnect = reactWrapper(GlConnectWC, { tagName: 'gl-connect' });
