'use strict';
import { InputBox, QuickInputButton, QuickInputButtons, QuickPick, QuickPickItem } from 'vscode';
import { Promises } from '../system';
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
    validate?(selection: T[]): boolean | Promise<boolean>;
}

export function isQuickPickStep(item: QuickPickStep | QuickInputStep): item is QuickPickStep {
    return (item as QuickPickStep).items !== undefined;
}

export type StepState<T> = Partial<T> & { counter: number; confirm?: boolean };

export abstract class QuickCommandBase<T = any> implements QuickPickItem {
    static is(item: QuickPickItem): item is QuickCommandBase {
        return item instanceof QuickCommandBase;
    }

    readonly description?: string;
    readonly detail?: string;

    protected _initialState?: StepState<T>;

    private _current: QuickPickStep | QuickInputStep | undefined;
    private _stepsIterator: AsyncIterableIterator<QuickPickStep | QuickInputStep> | undefined;

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

    protected abstract steps(): AsyncIterableIterator<QuickPickStep | QuickInputStep>;

    async previous(): Promise<QuickPickStep | QuickInputStep | undefined> {
        return (await this.next(Directive.Back)).value;
    }

    async next(value?: QuickPickItem[] | string | Directive): Promise<IteratorResult<QuickPickStep | QuickInputStep>> {
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

    protected canMoveNext<T extends QuickPickItem>(
        step: QuickPickStep<T>,
        state: { counter: number },
        selection: T[] | Directive | undefined
    ): selection is T[];
    protected canMoveNext<T extends string>(
        step: QuickInputStep,
        state: { counter: number },
        value: string | Directive | undefined
    ): boolean | Promise<boolean>;
    protected canMoveNext<T extends any>(
        step: QuickPickStep | QuickInputStep,
        state: { counter: number },
        value: T[] | string | Directive | undefined
    ) {
        if (value === Directive.Back) {
            state.counter--;
            if (state.counter < 0) {
                state.counter = 0;
            }
            return false;
        }

        if (step.validate === undefined || (isQuickPickStep(step) && step.validate!(value as T[]))) {
            state.counter++;
            return true;
        }

        if (isQuickInputStep(step)) {
            const result = step.validate!(value as string);
            if (!Promises.isPromise(result)) {
                const [valid] = result;
                if (valid) {
                    state.counter++;
                }
                return valid;
            }

            return result.then(([valid]) => {
                if (valid) {
                    state.counter++;
                }
                return valid;
            });
        }

        return false;
    }
}
