import { reactWrapper } from '../../../shared/components/helpers/react-wrapper';
import { GlGraphSideBar as GlGraphSideBarWC } from './sidebar';

export interface GlGraphSideBar extends GlGraphSideBarWC {}
export const GlGraphSideBar = reactWrapper(GlGraphSideBarWC, { tagName: 'gl-graph-sidebar' });
