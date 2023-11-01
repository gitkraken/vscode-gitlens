import { reactWrapper } from '../helpers/react-wrapper';
import {
	MenuDivider as MenuDividerComponent,
	MenuItem as MenuItemComponent,
	MenuLabel as MenuLabelComponent,
	MenuList as MenuListComponent,
} from './index';

export const MenuDivider = reactWrapper(MenuDividerComponent, { tagName: 'menu-divider' });
export const MenuItem = reactWrapper(MenuItemComponent, { tagName: 'menu-item' });
export const MenuLabel = reactWrapper(MenuLabelComponent, { tagName: 'menu-label' });
export const MenuList = reactWrapper(MenuListComponent, { tagName: 'menu-list' });
