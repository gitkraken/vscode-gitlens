import type { Directive } from '../../../quickpicks/items/directive.js';
import type { StepResult } from './steps.js';

export interface CustomStep<T = unknown> {
	type: 'custom';

	ignoreFocusOut?: boolean;

	show(step: CustomStep<T>): Promise<StepResult<Directive | T>>;
}
