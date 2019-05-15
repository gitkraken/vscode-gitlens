'use strict';
import { CancellationTokenSource, commands, QuickPickItem, window } from 'vscode';
import { Commands } from '../commands';
import { configuration } from '../configuration';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { GitLog, GitLogCommit, GitRepoSearchBy, GitStashCommit, GitUri } from '../git/gitService';
import { KeyMapping, Keys } from '../keyboard';
import { Strings } from '../system';
import { ReferencesQuickPick, ReferencesQuickPickItem } from './referencesQuickPick';

export function getQuickPickIgnoreFocusOut() {
    return !configuration.get<boolean>(configuration.name('advanced')('quickPick')('closeOnFocusOut').value);
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
    }
    catch (ex) {
        // Not sure why this throws
    }
    finally {
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
    onDidPressKey?(key: Keys): Promise<{} | undefined>;
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
        }
        else if (typeof commandOrArgs === 'string') {
            this.command = commandOrArgs;
            this.args = args;
        }
        else {
            this.command = commandOrArgs[0];
            this.args = commandOrArgs.slice(1);
        }
        Object.assign(this, item);
    }

    execute(): Thenable<{} | undefined> {
        if (this.command === undefined) return Promise.resolve(undefined);

        return commands.executeCommand(this.command, ...(this.args || []));
    }

    onDidPressKey(key: Keys): Thenable<{} | undefined> {
        return this.execute();
    }
}

export class CommitQuickPickItem<T extends GitLogCommit = GitLogCommit> implements QuickPickItem {
    label: string;
    description: string;
    detail: string;

    constructor(public readonly commit: T) {
        const message = commit.getShortMessage();
        if (GitStashCommit.is(commit)) {
            this.label = message;
            this.description = '';
            this.detail = `${GlyphChars.Space} ${commit.stashName || commit.shortSha} ${Strings.pad(
                GlyphChars.Dot,
                1,
                1
            )} ${commit.formattedDate} ${Strings.pad(GlyphChars.Dot, 1, 1)} ${commit.getFormattedDiffStatus({
                compact: true
            })}`;
        }
        else {
            this.label = message;
            this.description = `${Strings.pad('$(git-commit)', 1, 1)} ${commit.shortSha}`;
            this.detail = `${GlyphChars.Space} ${commit.author}, ${commit.formattedDate}${
                commit.isFile
                    ? ''
                    : ` ${Strings.pad(GlyphChars.Dot, 1, 1)} ${commit.getFormattedDiffStatus({ compact: true })}`
            }`;
        }
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

export class ShowCommitInViewQuickPickItem extends CommandQuickPickItem {
    constructor(
        public readonly commit: GitLogCommit,
        item: QuickPickItem = {
            label: 'Show in View',
            description: `${Strings.pad(GlyphChars.Dash, 2, 2)} displays the commit in the GitLens Search Commits view`
        }
    ) {
        super(item, undefined, undefined);
    }

    async execute(): Promise<{} | undefined> {
        return void (await Container.searchView.search(this.commit.repoPath, this.commit.sha, GitRepoSearchBy.Sha, {
            label: { label: `commits with an id matching '${this.commit.shortSha}'` }
        }));
    }
}

export class ShowCommitSearchResultsInViewQuickPickItem extends CommandQuickPickItem {
    constructor(
        public readonly search: string,
        public readonly searchBy: GitRepoSearchBy,
        public readonly results: GitLog,
        public readonly resultsLabel: string | { label: string; resultsType?: { singular: string; plural: string } },
        item: QuickPickItem = {
            label: 'Show in View',
            description: `${Strings.pad(
                GlyphChars.Dash,
                2,
                2
            )} displays the search results in the GitLens Search Commits view`
        }
    ) {
        super(item, undefined, undefined);
    }

    async execute(): Promise<{} | undefined> {
        return void (await Container.searchView.showSearchResults(
            this.results.repoPath,
            this.search,
            this.searchBy,
            this.results,
            {
                label: this.resultsLabel
            }
        ));
    }
}

export class ShowFileHistoryFromQuickPickItem extends CommandQuickPickItem {
    constructor(
        private readonly repoPath: string,
        private readonly placeHolder: string,
        private readonly _goBack?: CommandQuickPickItem,
        item: QuickPickItem = {
            label: 'Show File History from...',
            description: `${Strings.pad(GlyphChars.Dash, 2, 2)} shows an alternate file history`
        }
    ) {
        super(item, undefined, undefined);
    }

    execute(): Promise<CommandQuickPickItem | ReferencesQuickPickItem | undefined> {
        return new ReferencesQuickPick(this.repoPath).show(this.placeHolder, {
            allowEnteringRefs: true,
            goBack: this._goBack
        });
    }
}

export class ShowFileHistoryInViewQuickPickItem extends CommandQuickPickItem {
    constructor(
        public readonly uri: GitUri,
        public readonly baseRef: string | undefined,
        item: QuickPickItem = {
            label: 'Show in View',
            description: `${Strings.pad(
                GlyphChars.Dash,
                2,
                2
            )} displays the file history in the GitLens File History view`
        }
    ) {
        super(item, undefined, undefined);
    }

    async execute(): Promise<{} | undefined> {
        return void (await Container.fileHistoryView.showHistoryForUri(this.uri, this.baseRef));
    }
}
