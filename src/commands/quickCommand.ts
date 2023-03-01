import type { InputBox, QuickInputButton, QuickPick, QuickPickItem } from 'vscode';
import type { Container } from '../container';
import type { DirectiveQuickPickItem } from '../quickpicks/items/directive';
import { createDirectiveQuickPickItem, Directive, isDirective } from '../quickpicks/items/directive';
import { configuration } from '../system/configuration';
import type { Keys } from '../system/keyboard';

export * from './quickCommand.buttons';
export * from './quickCommand.steps';

export interface CustomStep<T = unknown> {
	ignoreFocusOut?: boolean;

	show(step: CustomStep<T>): Promise<StepResult<Directive | T>>;
}

export function isCustomStep(
	step: QuickPickStep | QuickInputStep | CustomStep | typeof StepResultBreak,
): step is CustomStep {
	return typeof step === 'object' && (step as CustomStep).show != null;
}

export interface QuickInputStep {
	additionalButtons?: QuickInputButton[];
	buttons?: QuickInputButton[];
	ignoreFocusOut?: boolean;
	keys?: StepNavigationKeys[];
	placeholder?: string;
	prompt?: string;
	title?: string;
	value?: string;

	onDidClickButton?(input: InputBox, button: QuickInputButton): boolean | void | Promise<boolean | void>;
	onDidPressKey?(quickpick: InputBox, key: Keys): void | Promise<void>;
	validate?(value: string | undefined): [boolean, string | undefined] | Promise<[boolean, string | undefined]>;
}

export function isQuickInputStep(
	step: QuickPickStep | QuickInputStep | typeof StepResultBreak,
): step is QuickInputStep {
	return typeof step === 'object' && (step as QuickPickStep).items == null && (step as CustomStep).show == null;
}

export interface QuickPickStep<T extends QuickPickItem = QuickPickItem> {
	additionalButtons?: QuickInputButton[];
	allowEmpty?: boolean;
	buttons?: QuickInputButton[];
	ignoreFocusOut?: boolean;
	items: (DirectiveQuickPickItem | T)[]; // | DirectiveQuickPickItem[];
	keys?: StepNavigationKeys[];
	matchOnDescription?: boolean;
	matchOnDetail?: boolean;
	multiselect?: boolean;
	placeholder?: string;
	selectedItems?: QuickPickItem[];
	title?: string;
	value?: string;
	selectValueWhenShown?: boolean;

	onDidAccept?(quickpick: QuickPick<T>): boolean | Promise<boolean>;
	onDidChangeValue?(quickpick: QuickPick<T>): boolean | Promise<boolean>;
	onDidClickButton?(quickpick: QuickPick<T>, button: QuickInputButton): boolean | void | Promise<boolean | void>;
	/**
	 * @returns `true` if the current item should be selected
	 */
	onDidClickItemButton?(
		quickpick: QuickPick<T>,
		button: QuickInputButton,
		item: T,
	): boolean | void | Promise<boolean | void>;
	onDidLoadMore?(quickpick: QuickPick<T>): (DirectiveQuickPickItem | T)[] | Promise<(DirectiveQuickPickItem | T)[]>;
	onDidPressKey?(quickpick: QuickPick<T>, key: Keys): void | Promise<void>;
	onValidateValue?(quickpick: QuickPick<T>, value: string, items: T[]): boolean | Promise<boolean>;
	validate?(selection: T[]): boolean;
}

export function isQuickPickStep(
	step: QuickPickStep | QuickInputStep | CustomStep | typeof StepResultBreak,
): step is QuickPickStep {
	return typeof step === 'object' && (step as QuickPickStep).items != null;
}

export type StepGenerator =
	| Generator<QuickPickStep | QuickInputStep | CustomStep, StepResult<void | undefined>, any | undefined>
	| AsyncGenerator<QuickPickStep | QuickInputStep | CustomStep, StepResult<void | undefined>, any | undefined>;

export type StepItemType<T> = T extends CustomStep<infer U>
	? U
	: T extends QuickPickStep<infer U>
	? U[]
	: T extends QuickInputStep
	? string
	: never;
export type StepNavigationKeys = Exclude<Keys, 'left' | 'alt+left' | 'ctrl+left'>;
export const StepResultBreak = Symbol('BreakStep');
export type StepResult<T> = typeof StepResultBreak | T;
export type StepResultGenerator<T> = Generator<
	QuickPickStep | QuickInputStep | CustomStep,
	StepResult<T>,
	any | undefined
>;
export type AsyncStepResultGenerator<T> = AsyncGenerator<
	QuickPickStep | QuickInputStep | CustomStep,
	StepResult<T>,
	any | undefined
>;
// Can't use this union type because of https://github.com/microsoft/TypeScript/issues/41428
// export type StepResultGenerator<T> =
// 	| Generator<QuickPickStep | QuickInputStep, StepResult<T>, any | undefined>
// 	| AsyncGenerator<QuickPickStep | QuickInputStep, StepResult<T>, any | undefined>;
export type StepSelection<T> = T extends CustomStep<infer U>
	? U | Directive
	: T extends QuickPickStep<infer U>
	? U[] | Directive
	: T extends QuickInputStep
	? string | Directive
	: never;
export type PartialStepState<T = unknown> = Partial<T> & { counter: number; confirm?: boolean; startingStep?: number };
export type StepState<T = Record<string, unknown>> = T & { counter: number; confirm?: boolean; startingStep?: number };

export abstract class QuickCommand<State = any> implements QuickPickItem {
	readonly description?: string;
	readonly detail?: string;

	protected initialState: PartialStepState<State> | undefined;

	private _currentStep: QuickPickStep | QuickInputStep | CustomStep | undefined;
	private _stepsIterator: StepGenerator | undefined;

	constructor(
		protected readonly container: Container,
		public readonly key: string,
		public readonly label: string,
		public readonly title: string,
		options: {
			description?: string;
			detail?: string;
		} = {},
	) {
		this.description = options.description;
		this.detail = options.detail;
	}

	get canConfirm(): boolean {
		return true;
	}

	get canSkipConfirm(): boolean {
		return true;
	}

	private _picked: boolean = false;
	get picked() {
		return this._picked;
	}
	set picked(value: boolean) {
		this._picked = value;
		if (!value) {
			this._pickedVia = 'menu';
		}
	}

	private _pickedVia: 'menu' | 'command' = 'menu';
	get pickedVia() {
		return this._pickedVia;
	}
	set pickedVia(value: 'menu' | 'command') {
		this._pickedVia = value;
	}

	get skipConfirmKey(): string {
		return `${this.key}:${this.pickedVia}`;
	}

	get value(): QuickPickStep | QuickInputStep | CustomStep | undefined {
		return this._currentStep;
	}

	confirm(override?: boolean) {
		if (!this.canConfirm || !this.canSkipConfirm) return true;

		return override != null
			? override
			: !configuration.get('gitCommands.skipConfirmations').includes(this.skipConfirmKey);
	}

	isMatch(key: string) {
		return this.key === key;
	}

	isFuzzyMatch(name: string) {
		return this.label === name;
	}

	protected abstract steps(state: PartialStepState<State>): StepGenerator;

	executeSteps() {
		// When we are chaining steps together, limit backward navigation to feel more natural
		return this.steps(this.getStepState(true));
	}

	async previous(): Promise<QuickPickStep | QuickInputStep | undefined> {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-return
		return (await this.next(Directive.Back)).value;
	}

	async next(
		value?: StepSelection<any>,
	): Promise<IteratorResult<QuickPickStep | QuickInputStep | CustomStep | undefined>> {
		if (this._stepsIterator == null) {
			this._stepsIterator = this.steps(this.getStepState(false));
		}

		const result = await this._stepsIterator.next(value);
		if (result.done) {
			this.initialState = undefined;
			this._stepsIterator = undefined;
		}

		if (result.value === StepResultBreak) {
			this._currentStep = undefined;
			return { ...result, value: undefined };
		}

		this._currentStep = result.value as Exclude<typeof result.value, void | typeof StepResultBreak>;
		return result;
	}

	async retry(): Promise<QuickPickStep | QuickInputStep | CustomStep | undefined> {
		await this.next(Directive.Noop);
		return this.value;
	}

	protected canStepsContinue(state: PartialStepState) {
		return state.counter >= (state.startingStep ?? 0);
	}

	protected createConfirmStep<T extends QuickPickItem>(
		title: string,
		confirmations: T[],
		cancel?: DirectiveQuickPickItem,
		options: Partial<QuickPickStep<T>> = {},
	): QuickPickStep<T> {
		return createConfirmStep(title, confirmations, { title: this.title }, cancel, options);
	}

	protected getStepState(limitBackNavigation: boolean): PartialStepState<State> {
		// Set the minimum step to be our initial counter, so that the back button will work as expected
		const state: PartialStepState<State> = {
			counter: 0,
			...this.initialState,
			startingStep: limitBackNavigation ? this.initialState?.counter ?? 0 : 0,
		} as unknown as PartialStepState<State>;
		return state;
	}
}

export function isQuickCommand(item: QuickPickItem): item is QuickCommand {
	return item instanceof QuickCommand;
}

export async function canInputStepContinue<T extends QuickInputStep>(
	step: T,
	state: PartialStepState,
	value: Directive | StepItemType<T>,
) {
	if (!canStepContinue(step, state, value)) return false;

	const [valid] = (await step.validate?.(value)) ?? [true];
	if (valid) {
		state.counter++;
		return true;
	}

	return false;
}

export function canPickStepContinue<T extends QuickPickStep>(
	step: T,
	state: PartialStepState,
	selection: StepItemType<T> | Directive,
): selection is StepItemType<T> {
	if (!canStepContinue(step, state, selection)) return false;

	if (step.validate?.(selection) ?? true) {
		state.counter++;
		return true;
	}

	return false;
}

export function canStepContinue<T extends QuickInputStep | QuickPickStep>(
	step: T,
	state: PartialStepState,
	result: Directive | StepItemType<T>,
): result is StepItemType<T> {
	if (result == null) return false;
	if (isDirective(result)) {
		switch (result) {
			case Directive.Back:
				state.counter--;
				if (state.counter <= (state.startingStep ?? 0)) {
					state.counter = 0;
				}
				break;
			case Directive.Cancel:
				endSteps(state);
				break;
			// case Directive.Noop:
			// case Directive.RequiresVerification:
			// case Directive.RequiresFreeSubscription:
			// case Directive.RequiresProSubscription:
			// 	break;
		}
		return false;
	}

	return true;
}

export function createConfirmStep<T extends QuickPickItem, Context extends { title: string }>(
	title: string,
	confirmations: T[],
	context: Context,
	cancel?: DirectiveQuickPickItem,
	options: Partial<QuickPickStep<T>> = {},
): QuickPickStep<T> {
	return createPickStep<T>({
		placeholder: `Confirm ${context.title}`,
		title: title,
		ignoreFocusOut: true,
		items: [...confirmations, cancel ?? createDirectiveQuickPickItem(Directive.Cancel)],
		selectedItems: [confirmations.find(c => c.picked) ?? confirmations[0]],
		...options,
	});
}

export function createInputStep(step: QuickInputStep): QuickInputStep {
	// Make sure any input steps won't close on focus loss
	step.ignoreFocusOut = true;
	return step;
}

export function createPickStep<T extends QuickPickItem>(step: QuickPickStep<T>): QuickPickStep<T> {
	return step;
}

export function createCustomStep<T>(step: CustomStep<T>): CustomStep<T> {
	return step;
}

export function endSteps(state: PartialStepState) {
	state.counter = -1;
}
