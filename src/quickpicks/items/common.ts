import type { QuickPickItem } from 'vscode';
import { commands, QuickPickItemKind } from 'vscode';
import type { Commands } from '../../constants';
import type { Keys } from '../../system/keyboard';

declare module 'vscode' {
	interface QuickPickItem {
		onDidSelect?(): void;
		onDidPressKey?(key: Keys): Promise<void>;
	}
}

export interface QuickPickSeparator extends QuickPickItem {
	kind: QuickPickItemKind.Separator;
}

export function createQuickPickSeparator(label?: string): QuickPickSeparator {
	return { kind: QuickPickItemKind.Separator, label: label ?? '' };
}

export interface QuickPickItemOfT<T = any> extends QuickPickItem {
	readonly item: T;
}

export class CommandQuickPickItem<Arguments extends any[] = any[]> implements QuickPickItem {
	static fromCommand<T>(label: string, command: Commands, args?: T): CommandQuickPickItem;
	static fromCommand<T>(item: QuickPickItem, command: Commands, args?: T): CommandQuickPickItem;
	static fromCommand<T>(labelOrItem: string | QuickPickItem, command: Commands, args?: T): CommandQuickPickItem {
		return new CommandQuickPickItem(
			typeof labelOrItem === 'string' ? { label: labelOrItem } : labelOrItem,
			command,
			args == null ? [] : [args],
		);
	}

	static is(item: QuickPickItem): item is CommandQuickPickItem {
		return item instanceof CommandQuickPickItem;
	}

	label!: string;
	description?: string;
	detail?: string | undefined;

	constructor(
		label: string,
		command?: Commands,
		args?: Arguments,
		options?: {
			onDidPressKey?: (key: Keys, result: Thenable<unknown>) => void;
			suppressKeyPress?: boolean;
		},
	);
	constructor(
		item: QuickPickItem,
		command?: Commands,
		args?: Arguments,
		options?: {
			onDidPressKey?: (key: Keys, result: Thenable<unknown>) => void;
			suppressKeyPress?: boolean;
		},
	);
	constructor(
		labelOrItem: string | QuickPickItem,
		command?: Commands,
		args?: Arguments,
		options?: {
			onDidPressKey?: (key: Keys, result: Thenable<unknown>) => void;
			suppressKeyPress?: boolean;
		},
	);
	constructor(
		labelOrItem: string | QuickPickItem,
		protected readonly command?: Commands,
		protected readonly args?: Arguments,
		protected readonly options?: {
			// onDidExecute?: (
			// 	options: { preserveFocus?: boolean; preview?: boolean } | undefined,
			// 	result: Thenable<unknown>,
			// ) => void;
			onDidPressKey?: (key: Keys, result: Thenable<unknown>) => void;
			suppressKeyPress?: boolean;
		},
	) {
		this.command = command;
		this.args = args;

		if (typeof labelOrItem === 'string') {
			this.label = labelOrItem;
		} else {
			Object.assign(this, labelOrItem);
		}
	}

	execute(_options?: { preserveFocus?: boolean; preview?: boolean }): Promise<unknown | undefined> {
		if (this.command === undefined) return Promise.resolve(undefined);

		const result = commands.executeCommand(this.command, ...(this.args ?? [])) as Promise<unknown | undefined>;
		// this.options?.onDidExecute?.(options, result);
		return result;
	}

	async onDidPressKey(key: Keys): Promise<void> {
		if (this.options?.suppressKeyPress) return;

		const result = this.execute({ preserveFocus: true, preview: false });
		this.options?.onDidPressKey?.(key, result);
		void (await result);
	}
}

export class ActionQuickPickItem extends CommandQuickPickItem {
	constructor(
		labelOrItem: string | QuickPickItem,
		private readonly action: (options?: { preserveFocus?: boolean; preview?: boolean }) => void | Promise<void>,
	) {
		super(labelOrItem, undefined, undefined);
	}

	override async execute(options?: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return this.action(options);
	}
}
