import type { QuickPickItem, ThemeIcon, Uri } from 'vscode';
import { commands, QuickPickItemKind } from 'vscode';
import type { Keys } from '../../constants';
import type { GlCommands } from '../../constants.commands';

declare module 'vscode' {
	interface QuickPickItem {
		onDidSelect?(): void;
		onDidPressKey?(key: Keys): Promise<void>;
	}
}

export interface QuickPickSeparator extends QuickPickItem {
	kind: QuickPickItemKind.Separator;
}

export function createQuickPickSeparator<T = QuickPickSeparator>(label?: string): T {
	return { kind: QuickPickItemKind.Separator, label: label ?? '' } as unknown as T;
}

export interface QuickPickItemOfT<T = any> extends QuickPickItem {
	readonly item: T;
}

export function createQuickPickItemOfT<T = any>(labelOrItem: string | QuickPickItem, item: T): QuickPickItemOfT<T> {
	return typeof labelOrItem === 'string' ? { label: labelOrItem, item: item } : { ...labelOrItem, item: item };
}

export class CommandQuickPickItem<Arguments extends any[] = any[]> implements QuickPickItem {
	static fromCommand<T>(label: string, command: GlCommands, args?: T): CommandQuickPickItem;
	static fromCommand<T>(item: QuickPickItem, command: GlCommands, args?: T): CommandQuickPickItem;
	static fromCommand<T>(labelOrItem: string | QuickPickItem, command: GlCommands, args?: T): CommandQuickPickItem {
		return new CommandQuickPickItem(
			typeof labelOrItem === 'string' ? { label: labelOrItem } : labelOrItem,
			undefined,
			command,
			args == null ? [] : Array.isArray(args) ? args : [args],
		);
	}

	static is(item: QuickPickItem): item is CommandQuickPickItem {
		return item instanceof CommandQuickPickItem;
	}

	label!: string;
	description?: string;
	detail?: string | undefined;
	iconPath?: Uri | { light: Uri; dark: Uri } | ThemeIcon | undefined;

	constructor(
		label: string,
		iconPath?: Uri | { light: Uri; dark: Uri } | ThemeIcon | undefined,
		command?: GlCommands,
		args?: Arguments,
		options?: {
			onDidPressKey?: (key: Keys, result: Thenable<unknown>) => void;
			suppressKeyPress?: boolean;
		},
	);
	constructor(
		item: QuickPickItem,
		iconPath?: Uri | { light: Uri; dark: Uri } | ThemeIcon | undefined,
		command?: GlCommands,
		args?: Arguments,
		options?: {
			onDidPressKey?: (key: Keys, result: Thenable<unknown>) => void;
			suppressKeyPress?: boolean;
		},
	);
	constructor(
		labelOrItem: string | QuickPickItem,
		iconPath?: Uri | { light: Uri; dark: Uri } | ThemeIcon | undefined,
		command?: GlCommands,
		args?: Arguments,
		options?: {
			onDidPressKey?: (key: Keys, result: Thenable<unknown>) => void;
			suppressKeyPress?: boolean;
		},
	);
	constructor(
		labelOrItem: string | QuickPickItem,
		iconPath?: Uri | { light: Uri; dark: Uri } | ThemeIcon | undefined,
		protected readonly command?: GlCommands,
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

		if (iconPath != null) {
			this.iconPath = iconPath;
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
