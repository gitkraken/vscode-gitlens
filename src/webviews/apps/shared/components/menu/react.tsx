import { reactWrapper } from '../helpers/react-wrapper';
import { MenuItem as MenuItemComponent, MenuLabel as MenuLabelComponent, MenuList as MenuListComponent } from './index';

export const MenuItem = reactWrapper(MenuItemComponent);
export const MenuLabel = reactWrapper(MenuLabelComponent);
export const MenuList = reactWrapper(MenuListComponent);
