'use strict';
import { CancellationTokenSource, commands, QuickPickItem, window } from 'vscode';
import { Commands } from '../commands';
import { configuration } from '../configuration';
import { Container } from '../container';
import { GitLogCommit, GitStashCommit, GitUri, SearchPattern } from '../git/gitService';
import { KeyMapping, Keys } from '../keyboard';
import { ReferencesQuickPick, ReferencesQuickPickItem } from './referencesQuickPick';
import { GlyphChars } from '../constants';

export function getQuickPickIgnoreFocusOut() {
	return !configuration.get('advanced', 'quickPick', 'closeOnFocusOut');
}

export function showQuickPickProgress(message: string, mapping?: KeyMapping): CancellationTokenSource {
	const cancellation = new CancellationTokenSource();
	void _showQuickPickProgress(message, cancellation, mapping);
	return cancellation;
}

async function _showQuickPickProgress(message: string, cancellation: CancellationTokenSource, mapping?: KeyMapping) {
	const scope = mapping && (await Container.keyboard.beginScope(mapping));

	try {
		await window.showQuickPick(
			_getInfiniteCancellablePromise(cancellation),
			{
				placeHolder: message,
				ignoreFocusOut: getQuickPickIgnoreFocusOut()
			},
			cancellation.token
		);
	} catch (ex) {
		// Not sure why this throws
	} finally {
		cancellation.cancel();
		scope && scope.dispose();
	}
}

function _getInfiniteCancellablePromise(cancellation: CancellationTokenSource) {
	return new Promise<QuickPickItem[]>((resolve, reject) => {
		const disposable = cancellation.token.onCancellationRequested(() => {
			disposable.dispose();
			resolve([]);
		});
	});
}

export interface QuickPickItem extends QuickPickItem {
	onDidSelect?(): void;
	onDidPressKey?(key: Keys): Promise<void>;
}

export class CommandQuickPickItem implements QuickPickItem {
	label!: string;
	description!: string;
	detail?: string | undefined;
	protected command: Commands | undefined;
	protected args: any[] | undefined;

	constructor(item: QuickPickItem, args?: [Commands, any[]]);
	constructor(item: QuickPickItem, command?: Commands, args?: any[]);
	constructor(item: QuickPickItem, commandOrArgs?: Commands | [Commands, any[]], args?: any[]) {
		if (commandOrArgs === undefined) {
			this.command = undefined;
			this.args = args;
		} else if (typeof commandOrArgs === 'string') {
			this.command = commandOrArgs;
			this.args = args;
		} else {
			this.command = commandOrArgs[0];
			this.args = commandOrArgs.slice(1);
		}
		Object.assign(this, item);
	}

	execute(): Thenable<{} | undefined> {
		if (this.command === undefined) return Promise.resolve(undefined);

		return commands.executeCommand(this.command, ...(this.args || []));
	}

	async onDidPressKey(key: Keys): Promise<void> {
		await this.execute();
	}
}

export class KeyCommandQuickPickItem extends CommandQuickPickItem {
	constructor(command: Commands, args?: any[]) {
		super({ label: '', description: '' }, command, args);
	}
}

export class MessageQuickPickItem extends CommandQuickPickItem {
	constructor(message: string) {
		super({ label: message, description: '' });
	}
}

export class OpenInSearchCommitsViewQuickPickItem extends CommandQuickPickItem {
	constructor(
		public readonly commit: GitLogCommit,
		item: QuickPickItem = {
			label: '$(link-external) Show Commit in Search Commits View',
			description: ''
		}
	) {
		super(item, undefined, undefined);
	}

	async execute(): Promise<{} | undefined> {
		void (await Container.searchView.search(
			this.commit.repoPath,
			{
				pattern: SearchPattern.fromCommit(this.commit)
			},
			{
				label: { label: `for ${this.commit.isStash ? 'stash' : 'commit'} id ${this.commit.shortSha}` }
			}
		));

		return undefined;
	}
}

export class OpenInFileHistoryViewQuickPickItem extends CommandQuickPickItem {
	constructor(
		public readonly uri: GitUri,
		public readonly baseRef: string | undefined,
		item: QuickPickItem = {
			label: '$(eye) Show in File History View',
			description: 'shows the file history in the File History view'
		}
	) {
		super(item, undefined, undefined);
	}

	async execute(): Promise<{} | undefined> {
		return void (await Container.fileHistoryView.showHistoryForUri(this.uri, this.baseRef));
	}
}

export class RevealInRepositoriesViewQuickPickItem extends CommandQuickPickItem {
	constructor(
		public readonly commit: GitLogCommit | GitStashCommit,
		item: QuickPickItem = {
			label: '$(eye) Reveal Commit in Repositories View',
			description: `${commit.isStash ? '' : `${GlyphChars.Dash} this can take a while`}`
		}
	) {
		super(item, undefined, undefined);
	}

	async execute(): Promise<{} | undefined> {
		if (GitStashCommit.is(this.commit)) {
			void (await Container.repositoriesView.revealStash(this.commit, {
				select: true,
				focus: true,
				expand: true
			}));
		} else {
			void (await Container.repositoriesView.revealCommit(this.commit, {
				select: true,
				focus: true,
				expand: true
			}));
		}

		return undefined;
	}
}

export class ShowFileHistoryFromQuickPickItem extends CommandQuickPickItem {
	constructor(
		private readonly repoPath: string,
		private readonly placeHolder: string,
		private readonly _goBack?: CommandQuickPickItem,
		item: QuickPickItem = {
			label: '$(history) Show File History from...',
			description: 'shows an alternate file history'
		}
	) {
		super(item, undefined, undefined);
	}

	execute(): Promise<CommandQuickPickItem | ReferencesQuickPickItem | undefined> {
		return new ReferencesQuickPick(this.repoPath).show(this.placeHolder, {
			allowEnteringRefs: true,
			checkmarks: false,
			goBack: this._goBack
		});
	}
}
