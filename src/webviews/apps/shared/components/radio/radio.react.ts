import { reactWrapper } from '../helpers/react-wrapper';
import { Radio } from './radio';
import { RadioGroup } from './radio-group';

export const GlRadio = reactWrapper(Radio, {
	tagName: 'gl-radio',
});

export const GlRadioGroup = reactWrapper(RadioGroup, {
	tagName: 'gl-radio-group',
	events: {
		onChange: 'gl-change-value',
	},
});
