'use strict';
import { InputBox, QuickInputButton, QuickInputButtons, QuickPick, QuickPickItem } from 'vscode';
import { Directive, DirectiveQuickPickItem } from '../quickpicks';
import { Container } from '../container';

export * from './quickCommand.helpers';

export class BreakQuickCommand extends Error {
    constructor() {
        super('break');
    }
}

export interface QuickInputStep {
    additionalButtons?: QuickInputButton[];
    buttons?: QuickInputButton[];
    placeholder?: string;
    title?: string;
    value?: string;

    onDidClickButton?(input: InputBox, button: QuickInputButton): void;
    validate?(value: string | undefined): [boolean, string | undefined] | Promise<[boolean, string | undefined]>;
}

export function isQuickInputStep(item: QuickPickStep | QuickInputStep): item is QuickInputStep {
    return (item as QuickPickStep).items === undefined;
}

export interface QuickPickStep<T extends QuickPickItem = any> {
    additionalButtons?: QuickInputButton[];
    buttons?: QuickInputButton[];
    selectedItems?: QuickPickItem[];
    items: (DirectiveQuickPickItem | T)[] | DirectiveQuickPickItem[];
    matchOnDescription?: boolean;
    matchOnDetail?: boolean;
    multiselect?: boolean;
    placeholder?: string;
    title?: string;
    value?: string;

    onDidAccept?(quickpick: QuickPick<T>): Promise<boolean>;
    onDidClickButton?(quickpick: QuickPick<T>, button: QuickInputButton): void;
    onValidateValue?(quickpick: QuickPick<T>, value: string, items: T[]): Promise<boolean>;
    validate?(selection: T[]): boolean;
}

export function isQuickPickStep(item: QuickPickStep | QuickInputStep): item is QuickPickStep {
    return (item as QuickPickStep).items !== undefined;
}

export type StepAsyncGenerator = AsyncGenerator<QuickPickStep | QuickInputStep, undefined, any | undefined>;
type StepItemType<T> = T extends QuickPickStep<infer U> ? U[] : T extends QuickInputStep ? string : never;
export type StepSelection<T> = T extends QuickPickStep<infer U>
    ? U[] | Directive
    : T extends QuickInputStep
    ? string | Directive
    : never;
export type StepState<T> = Partial<T> & { counter: number; confirm?: boolean };

export abstract class QuickCommandBase<T = any> implements QuickPickItem {
    static is(item: QuickPickItem): item is QuickCommandBase {
        return item instanceof QuickCommandBase;
    }

    readonly description?: string;
    readonly detail?: string;

    protected _initialState?: StepState<T>;

    private _current: QuickPickStep | QuickInputStep | undefined;
    private _stepsIterator: StepAsyncGenerator | undefined;

    constructor(
        public readonly key: string,
        public readonly label: string,
        public readonly title: string,
        private readonly _canSkipConfirm: boolean = true,
        options: {
            description?: string;
            detail?: string;
        } = {}
    ) {
        this.description = options.description;
        this.detail = options.detail;
    }

    get canSkipConfirm(): boolean {
        return this._canSkipConfirm;
    }

    get confirmationKey(): string | undefined {
        return this.key;
    }

    private _picked: boolean = false;
    get picked() {
        return this._picked;
    }
    set picked(value: boolean) {
        this._picked = value;
    }

    confirm(override?: boolean) {
        if (!this.canSkipConfirm || this.confirmationKey === undefined) return true;

        return override !== undefined
            ? override
            : !Container.config.gitCommands.skipConfirmations.includes(this.confirmationKey);
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
        {
            cancel,
            placeholder
        }: {
            cancel?: DirectiveQuickPickItem;
            placeholder?: string;
        } = {}
    ): QuickPickStep<T> {
        return this.createPickStep<T>({
            placeholder: placeholder || `Confirm ${this.title}`,
            title: title,
            items: [...confirmations, cancel || DirectiveQuickPickItem.create(Directive.Cancel)],
            selectedItems: [confirmations[0]],
            buttons: [QuickInputButtons.Back]
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
        value: Directive | string
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
        selection: StepItemType<T> | Directive
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
