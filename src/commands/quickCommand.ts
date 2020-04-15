'use strict';
import { InputBox, QuickInputButton, QuickPick, QuickPickItem, Uri } from 'vscode';
import { Directive, DirectiveQuickPickItem } from '../quickpicks';
import { Container } from '../container';
import { Keys } from '../keyboard';

export * from './quickCommand.helpers';

export class ToggleQuickInputButton implements QuickInputButton {
	constructor(
		private _off: { icon: string; tooltip: string },
		private _on: { icon: string; tooltip: string },
		private _toggled = false,
	) {
		this._iconPath = this.getIconPath();
	}

	private _iconPath: { light: Uri; dark: Uri };
	get iconPath(): { light: Uri; dark: Uri } {
		return this._iconPath;
	}

	get tooltip(): string {
		return this._toggled ? this._on.tooltip : this._off.tooltip;
	}

	get on() {
		return this._toggled;
	}
	set on(value: boolean) {
		this._toggled = value;
		this._iconPath = this.getIconPath();
	}

	private getIconPath() {
		return {
			dark: Uri.file(
				Container.context.asAbsolutePath(`images/dark/icon-${this.on ? this._on.icon : this._off.icon}.svg`),
			),
			light: Uri.file(
				Container.context.asAbsolutePath(`images/light/icon-${this.on ? this._on.icon : this._off.icon}.svg`),
			),
		};
	}
}

export class SelectableQuickInputButton extends ToggleQuickInputButton {
	constructor(tooltip: string, icon: string, selected: boolean = false) {
		super({ tooltip: tooltip, icon: icon }, { tooltip: tooltip, icon: `${icon}-selected` }, selected);
	}
}

export class BreakQuickCommand extends Error {
	constructor() {
		super('break');
	}
}

export interface QuickInputStep {
	additionalButtons?: QuickInputButton[];
	buttons?: QuickInputButton[];
	keys?: StepNavigationKeys[];
	placeholder?: string;
	title?: string;
	value?: string;

	onDidClickButton?(input: InputBox, button: QuickInputButton): void;
	onDidPressKey?(quickpick: InputBox, key: Keys): void | Promise<void>;
	validate?(value: string | undefined): [boolean, string | undefined] | Promise<[boolean, string | undefined]>;
}

export function isQuickInputStep(item: QuickPickStep | QuickInputStep): item is QuickInputStep {
	return (item as QuickPickStep).items === undefined;
}

export interface QuickPickStep<T extends QuickPickItem = any> {
	additionalButtons?: QuickInputButton[];
	allowEmpty?: boolean;
	buttons?: QuickInputButton[];
	items: (DirectiveQuickPickItem | T)[] | DirectiveQuickPickItem[];
	keys?: StepNavigationKeys[];
	matchOnDescription?: boolean;
	matchOnDetail?: boolean;
	multiselect?: boolean;
	placeholder?: string;
	selectedItems?: QuickPickItem[];
	title?: string;
	value?: string;

	onDidAccept?(quickpick: QuickPick<T>): boolean | Promise<boolean>;
	onDidChangeValue?(quickpick: QuickPick<T>): boolean | Promise<boolean>;
	onDidClickButton?(quickpick: QuickPick<T>, button: QuickInputButton): void;
	onDidPressKey?(quickpick: QuickPick<T>, key: Keys): void | Promise<void>;
	onValidateValue?(quickpick: QuickPick<T>, value: string, items: T[]): boolean | Promise<boolean>;
	validate?(selection: T[]): boolean;
}

export function isQuickPickStep(item: QuickPickStep | QuickInputStep): item is QuickPickStep {
	return (item as QuickPickStep).items !== undefined;
}

export type StepAsyncGenerator = AsyncGenerator<QuickPickStep | QuickInputStep, undefined, any | undefined>;
type StepItemType<T> = T extends QuickPickStep<infer U> ? U[] : T extends QuickInputStep ? string : never;
export type StepNavigationKeys = Exclude<Exclude<Exclude<Keys, 'left'>, 'alt+left'>, 'ctrl+left'>;
export type StepSelection<T> = T extends QuickPickStep<infer U>
	? U[] | Directive
	: T extends QuickInputStep
	? string | Directive
	: never;
export type StepState<T> = Partial<T> & { counter: number; confirm?: boolean };

export abstract class QuickCommandBase<TState = any> implements QuickPickItem {
	static is(item: QuickPickItem): item is QuickCommandBase {
		return item instanceof QuickCommandBase;
	}

	readonly description?: string;
	readonly detail?: string;

	protected _initialState?: StepState<TState>;

	private _current: QuickPickStep | QuickInputStep | undefined;
	private _stepsIterator: StepAsyncGenerator | undefined;

	constructor(
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

	confirm(override?: boolean) {
		if (!this.canConfirm || !this.canSkipConfirm) return true;

		return override !== undefined
			? override
			: !Container.config.gitCommands.skipConfirmations.includes(this.skipConfirmKey);
	}

	isMatch(name: string) {
		return this.label === name;
	}

	protected abstract steps(): StepAsyncGenerator;

	async previous(): Promise<QuickPickStep | QuickInputStep | undefined> {
		return (await this.next(Directive.Back)).value;
	}

	async next(value?: StepSelection<any>): Promise<IteratorResult<QuickPickStep | QuickInputStep>> {
		if (this._stepsIterator === undefined) {
			this._stepsIterator = this.steps();
		}

		const result = await this._stepsIterator.next(value);
		this._current = result.value;

		if (result.done) {
			this._initialState = undefined;
			this._stepsIterator = undefined;
		}

		return result;
	}

	get value(): QuickPickStep | QuickInputStep | undefined {
		return this._current;
	}

	protected createConfirmStep<T extends QuickPickItem>(
		title: string,
		confirmations: T[],
		cancel?: DirectiveQuickPickItem,
		options: Partial<QuickPickStep<T>> = {},
	): QuickPickStep<T> {
		return this.createPickStep<T>({
			placeholder: `Confirm ${this.title}`,
			title: title,
			items: [...confirmations, cancel || DirectiveQuickPickItem.create(Directive.Cancel)],
			selectedItems: [confirmations.find(c => c.picked) || confirmations[0]],
			...options,
		});
	}

	protected createInputStep(step: QuickInputStep): QuickInputStep {
		return step;
	}

	protected createPickStep<T extends QuickPickItem>(step: QuickPickStep<T>): QuickPickStep<T> {
		return step;
	}

	protected async canInputStepMoveNext<T extends QuickInputStep>(
		step: T,
		state: { counter: number },
		value: Directive | string,
	) {
		//: value is string
		if (value === Directive.Cancel) throw new BreakQuickCommand();
		if (value === Directive.Back) {
			state.counter--;
			if (state.counter < 0) {
				state.counter = 0;
			}
			return false;
		}

		if (value === undefined) return false;

		if (step.validate === undefined || (await step.validate(value))) {
			state.counter++;
			return true;
		}

		return false;
	}

	protected canPickStepMoveNext<T extends QuickPickStep>(
		step: T,
		state: { counter: number },
		selection: StepItemType<T> | Directive,
	): selection is StepItemType<T> {
		if (selection === Directive.Cancel) throw new BreakQuickCommand();
		if (selection === Directive.Back) {
			state.counter--;
			if (state.counter < 0) {
				state.counter = 0;
			}
			return false;
		}

		if (selection === undefined) return false;

		if (step.validate === undefined || step.validate(selection)) {
			state.counter++;
			return true;
		}

		return false;
	}
}
