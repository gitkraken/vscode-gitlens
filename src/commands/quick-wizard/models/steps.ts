import type { Keys } from '../../../constants.js';
import type { Container } from '../../../container.js';
import type { Directive, DirectiveQuickPickItem } from '../../../quickpicks/items/directive.js';
import type { CustomStep } from './steps.custom.js';
import type { QuickInputStep } from './steps.quickinput.js';
import type { QuickPickStep } from './steps.quickpick.js';

export type StepGenerator = StepResultGenerator<void | undefined> | AsyncStepResultGenerator<void | undefined>;

export type StepItemType<T> =
	T extends CustomStep<infer U>
		? U
		: T extends QuickPickStep<infer U>
			? U[]
			: T extends QuickInputStep
				? string
				: never;
export type StepNavigationKeys = Exclude<Keys, 'left' | 'alt+left' | 'ctrl+left'>;

/**
 * Special symbol that signals the wizard steps are complete and should exit the loop.
 * This is used internally by StepsController to track completion state.
 *
 * For generator return values:
 * - Return `undefined` (or a result value in Phase 1) to signal successful completion
 * - Return `StepResultBreak` to signal user cancelled/backed out
 */

export const StepsComplete = Symbol.for('StepsComplete');

/**
 * Special symbol that signals the wizard steps should exit the loop.
 * This is used internally by StepsController to track completion state.
 *
 * For generator return values:
 * - Return `undefined` (or a result value in Phase 1) to signal successful completion
 * - Return `StepResultBreak` to signal user cancelled/backed out
 */
export const StepResultBreak = Symbol('BreakStep');

export type StepResult<T> = typeof StepResultBreak | T;
export type StepResultGenerator<T> = Generator<QuickPickStep | QuickInputStep | CustomStep, StepResult<T>>;
export type AsyncStepResultGenerator<T> = AsyncGenerator<QuickPickStep | QuickInputStep | CustomStep, StepResult<T>>;

export type StepSelection<T> =
	T extends CustomStep<infer U>
		? Exclude<U, DirectiveQuickPickItem> | Directive
		: T extends QuickPickStep<infer U>
			? Exclude<U, DirectiveQuickPickItem>[] | Directive
			: T extends QuickInputStep
				? string | Directive
				: never;

export type StepStartedFrom = 'menu' | 'command';

export type PartialStepState<T = unknown> = Partial<T> & { confirm?: boolean };
export type StepState<T = Record<string, unknown>> = T & { confirm?: boolean };

/**
 * Context type that commands extend to enable step navigation
 * Commands should include `steps?: StepsNavigation<StepName>` in their context
 */

export type StepsContext<StepNames extends string> = {
	container: Container;
	title: string;
	steps?: StepsNavigation<StepNames>;
};

/** Navigation state for step-based wizards */
export type StepsNavigation<StepNames extends string = string> = {
	/** Whether we can go backwards from the current step */
	canGoBack: boolean;
	/** The current (or next) step - undefined means no step is active */
	currentStep: StepNames | typeof StepsComplete | undefined;
	/** The first step the user reached - undefined before first step */
	startingStep: StepNames | undefined;
	/** History of steps visited by the user, split into individual arrays for each level of generator */
	history: StepNames[][];
	/** How the command was started - 'menu' allows going back to menu, 'command' means launched directly */
	startedFrom?: StepStartedFrom;
};

export type StepPickResult<ValueType, ActionType extends { action: string }> =
	| { type: 'result'; value: ValueType }
	| ({ type: 'action' } & ActionType);
