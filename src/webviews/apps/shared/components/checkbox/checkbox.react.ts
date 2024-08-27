import { reactWrapper } from '../helpers/react-wrapper';
import { Checkbox } from './checkbox';

export const GlCheckbox = reactWrapper(Checkbox, {
	tagName: 'gl-checkbox',
	events: {
		onChange: 'gl-change-value',
	},
});
