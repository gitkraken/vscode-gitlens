import { reactWrapper } from '../helpers/react-wrapper';
import { Checkbox, tagName } from './checkbox';

export const GlCheckbox = reactWrapper(Checkbox, {
	tagName: tagName,
	events: {
		onChange: 'gl-change-value',
	},
});
