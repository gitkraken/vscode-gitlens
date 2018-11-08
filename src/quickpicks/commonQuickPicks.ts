'use strict';
import {
    CancellationTokenSource,
    commands,
    QuickPickItem,
    QuickPickOptions,
    TextDocumentShowOptions,
    TextEditor,
    Uri,
    window
} from 'vscode';
import { Commands, openEditor } from '../commands';
import { configuration } from '../configuration';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { GitLog, GitLogCommit, GitRepoSearchBy, GitStashCommit, GitUri } from '../git/gitService';
import { KeyMapping, Keys } from '../keyboard';
import { Functions, Strings } from '../system';
import { BranchesAndTagsQuickPick, BranchQuickPickItem, TagQuickPickItem } from './branchesAndTagsQuickPick';

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
            } as QuickPickOptions,
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

    execute(): Promise<{} | undefined> {
        if (this.command === undefined) return Promise.resolve(undefined);

        return commands.executeCommand(this.command, ...(this.args || [])) as Promise<{} | undefined>;
    }

    onDidPressKey(key: Keys): Promise<{} | undefined> {
        return this.execute();
    }
}

export class CommitQuickPickItem implements QuickPickItem {
    label: string;
    description: string;
    detail: string;

    constructor(
        public readonly commit: GitLogCommit
    ) {
        const message = commit.getShortMessage();
        if (commit.isStash) {
            this.label = message;
            this.description = '';
            this.detail = `${GlyphChars.Space} ${(commit as GitStashCommit).stashName || commit.shortSha} ${Strings.pad(
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

export class ChooseFromBranchesAndTagsQuickPickItem extends CommandQuickPickItem {
    constructor(
        private readonly repoPath: string,
        private readonly placeHolder: string,
        private readonly _goBack?: CommandQuickPickItem,
        item: QuickPickItem = {
            label: 'Choose from Branch or Tag History...',
            description: `${Strings.pad(GlyphChars.Dash, 2, 2)} shows list of branches and tags`
        }
    ) {
        super(item, undefined, undefined);
    }

    execute(): Promise<CommandQuickPickItem | BranchQuickPickItem | TagQuickPickItem | undefined> {
        return new BranchesAndTagsQuickPick(this.repoPath).show(this.placeHolder, { goBack: this._goBack });
    }
}

export class KeyCommandQuickPickItem extends CommandQuickPickItem {
    constructor(command: Commands, args?: any[]) {
        super({ label: '', description: '' } as QuickPickItem, command, args);
    }
}

export class MessageQuickPickItem extends CommandQuickPickItem {
    constructor(message: string) {
        super({ label: message, description: '' } as QuickPickItem);
    }
}

export class OpenFileCommandQuickPickItem extends CommandQuickPickItem {
    constructor(
        public readonly uri: Uri,
        item: QuickPickItem
    ) {
        super(item, undefined, undefined);
    }

    async execute(options?: TextDocumentShowOptions): Promise<TextEditor | undefined> {
        return openEditor(this.uri, options);
    }

    // onDidSelect(): Promise<{} | undefined> {
    //     return this.execute({
    //         preserveFocus: true,
    //         preview: true
    //     });
    // }

    onDidPressKey(key: Keys): Promise<{} | undefined> {
        return this.execute({
            preserveFocus: true,
            preview: false
        });
    }
}

export class OpenFilesCommandQuickPickItem extends CommandQuickPickItem {
    constructor(
        public readonly uris: Uri[],
        item: QuickPickItem
    ) {
        super(item, undefined, undefined);
    }

    async execute(
        options: TextDocumentShowOptions = { preserveFocus: false, preview: false }
    ): Promise<{} | undefined> {
        for (const uri of this.uris) {
            await openEditor(uri, options);
        }
        return undefined;
    }

    async onDidPressKey(key: Keys): Promise<{} | undefined> {
        return this.execute({
            preserveFocus: true,
            preview: false
        });
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
        await Container.searchView.search(this.commit.repoPath, this.commit.sha, GitRepoSearchBy.Sha, {
            label: { label: `commits with an id matching '${this.commit.shortSha}'` }
        });
        return undefined;
    }
}

export class ShowCommitSearchResultsInViewQuickPickItem extends CommandQuickPickItem {
    constructor(
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
        await Container.searchView.showSearchResults(this.results.repoPath, this.results, { label: this.resultsLabel });
        return undefined;
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
        await Container.fileHistoryView.showHistoryForUri(this.uri, this.baseRef);
        return undefined;
    }
}
