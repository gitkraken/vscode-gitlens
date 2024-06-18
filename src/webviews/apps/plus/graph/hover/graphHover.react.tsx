import { reactWrapper } from '../../../shared/components/helpers/react-wrapper';
import { GlGraphHover as GlGraphHoverWC } from './graphHover';

export interface GlGraphHover extends GlGraphHoverWC {}
export const GlGraphHover = reactWrapper(GlGraphHoverWC, { tagName: 'gl-graph-hover' });
