import type { QuickPickItem } from 'vscode';
import type { Container } from '../../container.js';
import type { DirectiveQuickPickItem } from '../../quickpicks/items/directive.js';
import { Directive } from '../../quickpicks/items/directive.js';
import { configuration } from '../../system/-webview/configuration.js';
import type { CustomStep } from './models/steps.custom.js';
import type {
	PartialStepState,
	StepGenerator,
	StepsContext,
	StepSelection,
	StepsNavigation,
	StepStartedFrom,
} from './models/steps.js';
import { StepResultBreak } from './models/steps.js';
import type { QuickInputStep } from './models/steps.quickinput.js';
import type { QuickPickStep } from './models/steps.quickpick.js';
import { createConfirmStep } from './utils/steps.utils.js';

export abstract class QuickCommand<State = any> implements QuickPickItem {
	readonly description?: string;
	readonly detail?: string;

	protected initialState: PartialStepState<State> | undefined;

	private _currentStep: QuickPickStep | QuickInputStep | CustomStep | undefined;
	private _stepsIterator: StepGenerator | undefined;

	/** Reference to the steps navigation context, set by StepsController when created with this command */
	stepsNavigation?: Readonly<StepsNavigation>;

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
	get picked(): boolean {
		return this._picked;
	}
	set picked(value: boolean) {
		this._picked = value;
		if (!value) {
			this._startedFrom = 'menu';
		}
	}

	private _startedFrom: StepStartedFrom = 'menu';
	get startedFrom(): StepStartedFrom {
		return this._startedFrom;
	}
	set startedFrom(value: StepStartedFrom) {
		this._startedFrom = value;
	}

	get skipConfirmKey(): string {
		return `${this.key}:${this.startedFrom}`;
	}

	get value(): QuickPickStep | QuickInputStep | CustomStep | undefined {
		return this._currentStep;
	}

	confirm(override?: boolean): boolean {
		if (!this.canConfirm || !this.canSkipConfirm) return true;

		return override ?? !configuration.get('gitCommands.skipConfirmations').includes(this.skipConfirmKey);
	}

	isMatch(key: string): boolean {
		return this.key === key;
	}

	isFuzzyMatch(name: string): boolean {
		return this.label === name;
	}

	protected abstract createContext(context?: StepsContext<any>): StepsContext<any>;

	protected abstract steps(state: PartialStepState<State>, context?: StepsContext<any>): StepGenerator;

	/**
	 * Returns the steps generator for use by parent commands to delegate.
	 * This allows parent commands to `yield*` into subcommand steps while
	 * maintaining the same QuickInput session and back navigation.
	 * @param state The current state (merged with initialState defaults)
	 * @param context The context passed by parent command (subclasses can override to use)
	 */
	getSteps(state: PartialStepState<State>, context: StepsContext<any>): StepGenerator {
		// Merge initialState defaults with passed state, allowing caller to override
		return this.steps({ ...this.initialState, ...state } as PartialStepState<State>, context);
	}

	executeSteps(context: StepsContext<any>): StepGenerator {
		return this.steps({ ...this.initialState } as PartialStepState<State>, this.createContext(context));
	}

	async previous(): Promise<QuickPickStep | QuickInputStep | undefined> {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-return
		return (await this.next(Directive.Back)).value;
	}

	async next(
		value?: StepSelection<any>,
	): Promise<IteratorResult<QuickPickStep | QuickInputStep | CustomStep | undefined>> {
		this._stepsIterator ??= this.steps({ ...this.initialState } as PartialStepState<State>);

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

	terminate(): void {
		void this._stepsIterator?.return?.(StepResultBreak);
		this._stepsIterator = undefined;
	}

	protected createConfirmStep<T extends QuickPickItem>(
		title: string,
		confirmations: T[],
		cancel?: DirectiveQuickPickItem,
		options: Partial<QuickPickStep<T>> = {},
	): QuickPickStep<T> {
		return createConfirmStep(title, confirmations, { title: this.title }, cancel, options);
	}
}
