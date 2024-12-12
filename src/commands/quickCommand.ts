import type { InputBox, QuickInputButton, QuickPick, QuickPickItem } from 'vscode';
import type { Keys } from '../constants';
import type { GlCommands } from '../constants.commands';
import type { Container } from '../container';
import { createQuickPickSeparator } from '../quickpicks/items/common';
import type { DirectiveQuickPickItem } from '../quickpicks/items/directive';
import { createDirectiveQuickPickItem, Directive, isDirective } from '../quickpicks/items/directive';
import { configuration } from '../system/vscode/configuration';

export interface CustomStep<T = unknown> {
	type: 'custom';

	ignoreFocusOut?: boolean;

	show(step: CustomStep<T>): Promise<StepResult<Directive | T>>;
}

export function isCustomStep(
	step: QuickPickStep | QuickInputStep | CustomStep | typeof StepResultBreak,
): step is CustomStep {
	return typeof step === 'object' && 'type' in step && step.type === 'custom';
}

export interface QuickInputStep<T extends string = string> {
	type: 'input';

	additionalButtons?: QuickInputButton[];
	buttons?: QuickInputButton[];
	disallowBack?: boolean;
	ignoreFocusOut?: boolean;
	isConfirmationStep?: boolean;
	keys?: StepNavigationKeys[];
	placeholder?: string;
	prompt?: string;
	title?: string;
	value?: T;

	onDidClickButton?(input: InputBox, button: QuickInputButton): boolean | void | Promise<boolean | void>;
	onDidPressKey?(quickpick: InputBox, key: Keys): void | Promise<void>;
	validate?(value: T | undefined): [boolean, T | undefined] | Promise<[boolean, T | undefined]>;
}

export function isQuickInputStep(
	step: QuickPickStep | QuickInputStep | CustomStep | typeof StepResultBreak,
): step is QuickInputStep {
	return typeof step === 'object' && 'type' in step && step.type === 'input';
}

export interface QuickPickStep<T extends QuickPickItem = QuickPickItem> {
	type: 'pick';

	additionalButtons?: QuickInputButton[];
	allowEmpty?: boolean;
	buttons?: QuickInputButton[];
	disallowBack?: boolean;
	ignoreFocusOut?: boolean;
	isConfirmationStep?: boolean;
	items: (DirectiveQuickPickItem | T)[] | Promise<(DirectiveQuickPickItem | T)[]>;
	keys?: StepNavigationKeys[];
	matchOnDescription?: boolean;
	matchOnDetail?: boolean;
	multiselect?: boolean;
	placeholder?: string | ((count: number) => string);
	selectedItems?: QuickPickItem[];
	title?: string;
	value?: string;
	selectValueWhenShown?: boolean;

	quickpick?: QuickPick<DirectiveQuickPickItem | T>;
	freeze?: () => Disposable;
	frozen?: boolean;

	onDidActivate?(quickpick: QuickPick<DirectiveQuickPickItem | T>): void;

	onDidAccept?(quickpick: QuickPick<DirectiveQuickPickItem | T>): boolean | Promise<boolean>;
	onDidChangeValue?(quickpick: QuickPick<DirectiveQuickPickItem | T>): boolean | Promise<boolean>;
	onDidChangeSelection?(quickpick: QuickPick<DirectiveQuickPickItem | T>, selection: readonly T[]): void;
	onDidClickButton?(
		quickpick: QuickPick<DirectiveQuickPickItem | T>,
		button: QuickInputButton,
	):
		| boolean
		| void
		| Promise<boolean | void | IteratorResult<QuickPickStep | QuickInputStep | CustomStep | undefined>>;
	/**
	 * @returns `true` if the current item should be selected
	 */
	onDidClickItemButton?(
		quickpick: QuickPick<DirectiveQuickPickItem | T>,
		button: QuickInputButton,
		item: T,
	): boolean | void | Promise<boolean | void>;
	onDidLoadMore?(
		quickpick: QuickPick<DirectiveQuickPickItem | T>,
	): (DirectiveQuickPickItem | T)[] | Promise<(DirectiveQuickPickItem | T)[]>;
	onDidPressKey?(quickpick: QuickPick<DirectiveQuickPickItem | T>, key: Keys, item: T): void | Promise<void>;
	onValidateValue?(
		quickpick: QuickPick<DirectiveQuickPickItem | T>,
		value: string,
		items: T[],
	): boolean | Promise<boolean>;
	validate?(selection: T[]): boolean;
}

export function isQuickPickStep(
	step: QuickPickStep | QuickInputStep | CustomStep | typeof StepResultBreak,
): step is QuickPickStep {
	return typeof step === 'object' && 'type' in step && step.type === 'pick';
}

export type StepGenerator =
	| Generator<QuickPickStep | QuickInputStep | CustomStep, StepResult<void | undefined>>
	| AsyncGenerator<QuickPickStep | QuickInputStep | CustomStep, StepResult<void | undefined>>;

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
export type StepResultGenerator<T> = Generator<QuickPickStep | QuickInputStep | CustomStep, StepResult<T>>;
export type AsyncStepResultGenerator<T> = AsyncGenerator<QuickPickStep | QuickInputStep | CustomStep, StepResult<T>>;
// Can't use this union type because of https://github.com/microsoft/TypeScript/issues/41428
// export type StepResultGenerator<T> =
// 	| Generator<QuickPickStep | QuickInputStep, StepResult<T>, any | undefined>
// 	| AsyncGenerator<QuickPickStep | QuickInputStep, StepResult<T>, any | undefined>;
export type StepSelection<T> = T extends CustomStep<infer U>
	? Exclude<U, DirectiveQuickPickItem> | Directive
	: T extends QuickPickStep<infer U>
	  ? Exclude<U, DirectiveQuickPickItem>[] | Directive
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
		options?: {
			description?: string;
			detail?: string;
		},
	) {
		this.description = options?.description;
		this.detail = options?.detail;
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
	selection: Directive | StepItemType<T>,
): selection is StepItemType<T> {
	if (!canStepContinue(step, state, selection)) return false;

	if (step.validate?.(selection) ?? true) {
		state.counter++;
		return true;
	}

	return false;
}

export function canStepContinue<T extends QuickInputStep | QuickPickStep | CustomStep>(
	_step: T,
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
	options?: Partial<QuickPickStep<T>>,
): QuickPickStep<T> {
	return createPickStep<T>({
		isConfirmationStep: true,
		placeholder: `Confirm ${context.title}`,
		title: title,
		ignoreFocusOut: true,
		items: [
			...confirmations,
			createQuickPickSeparator<T>(),
			cancel ?? createDirectiveQuickPickItem(Directive.Cancel),
		],
		selectedItems: [confirmations.find(c => c.picked) ?? confirmations[0]],
		...options,
	});
}

export function createInputStep<T extends string>(step: Optional<QuickInputStep<T>, 'type'>): QuickInputStep<T> {
	// Make sure any input steps won't close on focus loss
	return { type: 'input', ...step, ignoreFocusOut: true };
}

export function createPickStep<T extends QuickPickItem>(step: Optional<QuickPickStep<T>, 'type'>): QuickPickStep<T> {
	const original = step.onDidActivate;
	step = { type: 'pick' as const, ...step };
	step.onDidActivate = qp => {
		step.quickpick = qp;
		step.freeze = () => {
			qp.enabled = false;
			const originalFocusOut = qp.ignoreFocusOut;
			qp.ignoreFocusOut = true;
			step.frozen = true;
			return {
				[Symbol.dispose]: () => {
					step.frozen = false;
					qp.enabled = true;
					qp.ignoreFocusOut = originalFocusOut;
					qp.show();
				},
			};
		};
		original?.(qp);
	};

	return step as QuickPickStep<T>;
}

export function createCustomStep<T>(step: Optional<CustomStep<T>, 'type'>): CustomStep<T> {
	return { type: 'custom', ...step };
}

export function endSteps(state: PartialStepState) {
	state.counter = -1;
}

export interface CrossCommandReference<T = unknown> {
	command: GlCommands;
	args?: T;
}

export function isCrossCommandReference<T = unknown>(value: any): value is CrossCommandReference<T> {
	return value.command != null;
}

export function createCrossCommandReference<T>(command: GlCommands, args: T): CrossCommandReference<T> {
	return { command: command, args: args };
}
