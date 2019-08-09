'use strict';
import { InputBox, QuickInputButton, QuickPick, QuickPickItem } from 'vscode';
import { Promises } from '../../system/promise';

export * from './quickCommands.helpers';

export interface QuickInputStep {
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
    buttons?: QuickInputButton[];
    selectedItems?: QuickPickItem[];
    items: QuickPickItem[];
    multiselect?: boolean;
    placeholder?: string;
    title?: string;
    value?: string;

    onDidAccept?(quickpick: QuickPick<T>): Promise<boolean>;
    onDidClickButton?(quickpick: QuickPick<T>, button: QuickInputButton): void;
    validate?(selection: T[]): boolean | Promise<boolean>;
}

export function isQuickPickStep(item: QuickPickStep | QuickInputStep): item is QuickPickStep {
    return (item as QuickPickStep).items !== undefined;
}

export class CommandAbortError extends Error {
    constructor() {
        super('Abort');
    }
}

export type StepState<T> = Partial<T> & { counter: number; skipConfirmation?: boolean };

export abstract class QuickCommandBase<T = any> implements QuickPickItem {
    static is(item: QuickPickItem): item is QuickCommandBase {
        return item instanceof QuickCommandBase;
    }

    readonly description?: string;
    readonly detail?: string;

    private _current: QuickPickStep | QuickInputStep | undefined;
    private _stepsIterator: AsyncIterableIterator<QuickPickStep | QuickInputStep> | undefined;

    constructor(
        public readonly label: string,
        public readonly title: string,
        options: {
            description?: string;
            detail?: string;
        } = {}
    ) {
        this.description = options.description;
        this.detail = options.detail;
    }

    private _picked: boolean = false;
    get picked() {
        return this._picked;
    }
    set picked(value: boolean) {
        this._picked = value;
    }

    protected _initialState?: StepState<T>;

    protected abstract steps(): AsyncIterableIterator<QuickPickStep | QuickInputStep>;

    async previous(): Promise<QuickPickStep | QuickInputStep | undefined> {
        // Simulate going back, by having no selection
        return (await this.next([])).value;
    }

    async next(value?: QuickPickItem[] | string): Promise<IteratorResult<QuickPickStep | QuickInputStep>> {
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
        cancellable: boolean = true
    ): QuickPickStep<T> {
        return this.createPickStep<T>({
            placeholder: `Confirm ${this.title}`,
            title: title,
            items: cancellable ? [...confirmations, { label: 'Cancel' }] : confirmations,
            selectedItems: [confirmations[0]],
            // eslint-disable-next-line no-loop-func
            validate: (selection: T[]) => {
                if (selection[0].label === 'Cancel') throw new CommandAbortError();
                return true;
            }
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
        selection: T[] | undefined
    ): selection is T[];
    protected canMoveNext<T extends string>(
        step: QuickInputStep,
        state: { counter: number },
        value: string | undefined
    ): boolean | Promise<boolean>;
    protected canMoveNext<T extends any>(
        step: QuickPickStep | QuickInputStep,
        state: { counter: number },
        value: T[] | string | undefined
    ) {
        if (value === undefined || value.length === 0) {
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
                return result[0];
            }

            return result.then(([valid]) => valid);
        }

        return false;
    }
}
