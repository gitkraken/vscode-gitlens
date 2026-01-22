import type { InputBox, QuickInput, QuickInputButton } from 'vscode';
import type { Keys } from '../../../constants.js';
import type { UnifiedDisposable } from '../../../system/unifiedDisposable.js';
import type { StepNavigationKeys } from './steps.js';

export interface QuickInputStep<T extends string = string> {
	type: 'input';

	additionalButtons?: QuickInputButton[];
	buttons?: QuickInputButton[];
	canGoBack?: boolean;
	ignoreFocusOut?: boolean;
	isConfirmationStep?: boolean;
	keys?: StepNavigationKeys[];
	placeholder?: string;
	prompt?: string;
	title?: string;
	value?: T;

	input?: QuickInput;
	freeze?: () => UnifiedDisposable;
	frozen?: boolean;

	onDidActivate?(input: QuickInput): void;
	onDidClickButton?(input: InputBox, button: QuickInputButton): boolean | void | Promise<boolean | void>;
	onDidPressKey?(quickpick: InputBox, key: Keys): void | Promise<void>;
	validate?(value: T | undefined): [boolean, T | undefined] | Promise<[boolean, T | undefined]>;
}
