import { reactWrapper } from '../helpers/react-wrapper';
import {
	MenuDivider as MenuDividerComponent,
	MenuItem as MenuItemComponent,
	MenuLabel as MenuLabelComponent,
	MenuList as MenuListComponent,
} from './index';

export const MenuDivider = reactWrapper(MenuDividerComponent);
export const MenuItem = reactWrapper(MenuItemComponent);
export const MenuLabel = reactWrapper(MenuLabelComponent);
export const MenuList = reactWrapper(MenuListComponent);
