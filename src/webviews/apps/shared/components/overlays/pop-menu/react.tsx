import { reactWrapper } from '../../helpers/react-wrapper';
import { PopMenu as PopMenuComponent } from './index';

export const PopMenu = reactWrapper(PopMenuComponent, { tagName: 'pop-menu' });
