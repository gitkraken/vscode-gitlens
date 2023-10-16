import { reactWrapper } from '../helpers/react-wrapper';
import { PopOver as PopOverComponent } from './pop-over';

export const PopOver = reactWrapper(PopOverComponent, { tagName: 'pop-over' });
