import type { QuickInputButton, QuickPick, QuickPickItem } from 'vscode';
import type { Keys } from '../../../constants.js';
import type { DirectiveQuickPickItem } from '../../../quickpicks/items/directive.js';
import type { UnifiedDisposable } from '../../../system/unifiedDisposable.js';
import type { CustomStep } from './steps.custom.js';
import type { StepNavigationKeys } from './steps.js';
import type { QuickInputStep } from './steps.quickinput.js';

export interface QuickPickStep<T extends QuickPickItem = QuickPickItem> {
	type: 'pick';

	additionalButtons?: QuickInputButton[];
	allowEmpty?: boolean;
	buttons?: QuickInputButton[];
	canGoBack?: boolean;
	/**
	 * Called when the back button is pressed. Return `true` to prevent the default back navigation.
	 * This allows steps to intercept back and perform custom behavior (e.g., clear input first).
	 */
	onGoBack?(quickpick: QuickPick<DirectiveQuickPickItem | T>): boolean | Promise<boolean>;
	ignoreFocusOut?: boolean;
	isConfirmationStep?: boolean;
	items: (DirectiveQuickPickItem | T)[] | Promise<(DirectiveQuickPickItem | T)[]>;
	keys?: StepNavigationKeys[];
	matchOnDescription?: boolean;
	matchOnDetail?: boolean;
	multiselect?: boolean;
	placeholder?: string | ((count: number) => string | undefined);
	selectedItems?: QuickPickItem[];
	title?: string;
	value?: string;
	selectValueWhenShown?: boolean;

	quickpick?: QuickPick<DirectiveQuickPickItem | T>;
	freeze?: () => UnifiedDisposable;
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
