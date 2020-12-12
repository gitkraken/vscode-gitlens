'use strict';
import { commands, QuickPickItem } from 'vscode';
import { Commands, GitActions } from '../commands';
import { Container } from '../container';
import { GitReference, GitRevisionReference, GitStashCommit, SearchPattern } from '../git/git';
import { Keys } from '../keyboard';

declare module 'vscode' {
	interface QuickPickItem {
		onDidSelect?(): void;
		onDidPressKey?(key: Keys): Promise<void>;
	}
}

export interface QuickPickItemOfT<T = any> extends QuickPickItem {
	readonly item: T;
}

export enum Directive {
	Back,
	Cancel,
	LoadMore,
	Noop,
}

export namespace Directive {
	export function is<T>(value: Directive | T): value is Directive {
		return typeof value === 'number' && Directive[value] != null;
	}
}

export interface DirectiveQuickPickItem extends QuickPickItem {
	directive: Directive;
}

export namespace DirectiveQuickPickItem {
	export function create(
		directive: Directive,
		picked?: boolean,
		options: { label?: string; description?: string; detail?: string } = {},
	) {
		let label = options.label;
		if (label == null) {
			switch (directive) {
				case Directive.Back:
					label = 'Back';
					break;
				case Directive.Cancel:
					label = 'Cancel';
					break;
				case Directive.LoadMore:
					label = 'Load more';
					break;
				case Directive.Noop:
					label = 'Try again';
					break;
			}
		}

		const item: DirectiveQuickPickItem = {
			label: label,
			description: options.description,
			detail: options.detail,
			alwaysShow: true,
			picked: picked,
			directive: directive,
		};

		return item;
	}

	export function is(item: QuickPickItem): item is DirectiveQuickPickItem {
		return item != null && 'directive' in item;
	}
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

	async execute(options?: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return this.action(options);
	}
}

export type FlagsQuickPickItem<T> = QuickPickItemOfT<T[]>;
export namespace FlagsQuickPickItem {
	export function create<T>(flags: T[], item: T[], options: QuickPickItem) {
		return { ...options, item: item, picked: hasFlags(flags, item) };
	}
}

function hasFlags<T>(flags: T[], has?: T | T[]): boolean {
	if (has === undefined) return flags.length === 0;
	if (!Array.isArray(has)) return flags.includes(has);

	return has.length === 0 ? flags.length === 0 : has.every(f => flags.includes(f));
}

export class RevealInSideBarQuickPickItem extends CommandQuickPickItem {
	constructor(
		private readonly reference: GitRevisionReference,
		item: QuickPickItem = {
			label: `$(eye) Reveal ${GitReference.isStash(reference) ? 'Stash' : 'Commit'} in Side Bar`,
			description: GitReference.isStash(reference) ? '' : 'can take a while',
		},
	) {
		super(item, undefined, undefined);
	}

	async execute(options?: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		if (GitStashCommit.is(this.reference)) {
			void (await GitActions.Stash.reveal(this.reference, {
				select: true,
				focus: !(options?.preserveFocus ?? false),
				expand: true,
			}));
		} else {
			void (await GitActions.Commit.reveal(this.reference, {
				select: true,
				focus: !(options?.preserveFocus ?? false),
				expand: true,
			}));
		}
	}
}

export class SearchForCommitQuickPickItem extends CommandQuickPickItem {
	constructor(
		private readonly reference: GitRevisionReference,
		item: QuickPickItem = {
			label: '$(search) Search for Commit in Side Bar',
		},
	) {
		super(item, undefined, undefined);
	}

	async execute(options?: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		void (await Container.searchAndCompareView.search(
			this.reference.repoPath,
			{
				pattern: SearchPattern.fromCommit(this.reference),
			},
			{
				label: {
					label: `for ${GitReference.toString(this.reference, { icon: false })}`,
				},
				reveal: {
					select: true,
					focus: !(options?.preserveFocus ?? false),
					expand: true,
				},
			},
		));
	}
}
