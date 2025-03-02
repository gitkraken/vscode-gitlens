import { reactWrapper } from '../helpers/react-wrapper';
import { Radio, tagName as radioTagName } from './radio';
import { RadioGroup, tagName as radioGroupTagName } from './radio-group';

export const GlRadio = reactWrapper(Radio, {
	tagName: radioTagName,
});

export const GlRadioGroup = reactWrapper(RadioGroup, {
	tagName: radioGroupTagName,
	events: {
		onChange: 'gl-change-value',
	},
});
