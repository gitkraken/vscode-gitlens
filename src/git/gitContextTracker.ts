'use strict';
import { Functions } from '../system';
import { Disposable, Event, EventEmitter, TextDocumentChangeEvent, TextEditor, window, workspace } from 'vscode';
import { TextDocumentComparer } from '../comparers';
import { CommandContext, isTextEditor, setCommandContext } from '../constants';
import { GitService, GitUri, RepoChangedReasons } from '../gitService';
// import { Logger } from '../logger';

export enum BlameabilityChangeReason {
    BlameFailed = 'blame-failed',
    DocumentChanged = 'document-changed',
    EditorChanged = 'editor-changed',
    RepoChanged = 'repo-changed'
}

export interface BlameabilityChangeEvent {
    blameable: boolean;
    editor: TextEditor | undefined;
    reason: BlameabilityChangeReason;
}

export class GitContextTracker extends Disposable {

    private _onDidChangeBlameability = new EventEmitter<BlameabilityChangeEvent>();
    get onDidChangeBlameability(): Event<BlameabilityChangeEvent> {
        return this._onDidChangeBlameability.event;
    }

    private _context: { editor?: TextEditor, uri?: GitUri, blameable?: boolean, dirty: boolean, tracked?: boolean } = { dirty: false };
    private _disposable: Disposable | undefined;
    private _gitEnabled: boolean;

    constructor(private git: GitService) {
        super(() => this.dispose());

        this.onConfigurationChanged();
    }

    dispose() {
        this._disposable && this._disposable.dispose();
    }

    private onConfigurationChanged() {
        const gitEnabled = workspace.getConfiguration('git').get<boolean>('enabled', true);
        if (this._gitEnabled !== gitEnabled) {
            this._gitEnabled = gitEnabled;

            if (this._disposable !== undefined) {
                this._disposable.dispose();
                this._disposable = undefined;
            }

            setCommandContext(CommandContext.Enabled, gitEnabled);

            if (gitEnabled) {
                const subscriptions: Disposable[] = [
                    window.onDidChangeActiveTextEditor(Functions.debounce(this.onActiveTextEditorChanged, 50), this),
                    workspace.onDidChangeConfiguration(this.onConfigurationChanged, this),
                    workspace.onDidChangeTextDocument(Functions.debounce(this.onTextDocumentChanged, 50), this),
                    this.git.onDidBlameFail(this.onBlameFailed, this),
                    this.git.onDidChangeRepo(this.onRepoChanged, this)
                ];
                this._disposable = Disposable.from(...subscriptions);

                this.onActiveTextEditorChanged(window.activeTextEditor);
            }
        }
    }

    private onActiveTextEditorChanged(editor: TextEditor | undefined) {
        if (editor === this._context.editor) return;
        if (editor !== undefined && !isTextEditor(editor)) return;

        // Logger.log('GitContextTracker.onActiveTextEditorChanged', editor && editor.document.uri.fsPath);

        this.updateContext(BlameabilityChangeReason.EditorChanged, editor, true);
    }

    private onBlameFailed(key: string) {
        if (this._context.editor === undefined || key !== this.git.getCacheEntryKey(this._context.editor.document.uri)) return;

        this.updateBlameability(BlameabilityChangeReason.BlameFailed, false);
    }

    private onRepoChanged(reasons: RepoChangedReasons[]) {
        if (reasons.includes(RepoChangedReasons.CacheReset) || reasons.includes(RepoChangedReasons.Unknown)) {
            this.updateContext(BlameabilityChangeReason.RepoChanged, this._context.editor);

            return;
        }

        // TODO: Support multi-root
        if (!reasons.includes(RepoChangedReasons.Remotes) && !reasons.includes(RepoChangedReasons.Repositories)) return;

        this.updateRemotes(this._context.uri);
    }

    private onTextDocumentChanged(e: TextDocumentChangeEvent) {
        if (this._context.editor === undefined || !TextDocumentComparer.equals(this._context.editor.document, e.document)) return;

        // If we haven't changed state, kick out
        if (this._context.dirty === e.document.isDirty) return;

        // Logger.log('GitContextTracker.onTextDocumentChanged', 'Dirty state changed', e);

        this._context.dirty = e.document.isDirty;
        this.updateBlameability(BlameabilityChangeReason.DocumentChanged);
    }

    private async updateContext(reason: BlameabilityChangeReason, editor: TextEditor | undefined, force: boolean = false) {
        let tracked: boolean;
        if (force || this._context.editor !== editor) {
            this._context.editor = editor;

            if (editor !== undefined) {
                this._context.uri = await GitUri.fromUri(editor.document.uri, this.git);
                this._context.dirty = editor.document.isDirty;
                tracked = await this.git.isTracked(this._context.uri);
            }
            else {
                this._context.uri = undefined;
                this._context.dirty = false;
                this._context.blameable = false;
                tracked = false;
            }
        }
        else {
            // Since the tracked state could have changed, update it
            tracked = this._context.uri !== undefined
                ? await this.git.isTracked(this._context.uri!)
                : false;
        }

        if (this._context.tracked !== tracked) {
            this._context.tracked = tracked;
            setCommandContext(CommandContext.ActiveFileIsTracked, tracked);
        }

        this.updateBlameability(reason, undefined, force);
        this.updateRemotes(this._context.uri);
    }

    private updateBlameability(reason: BlameabilityChangeReason, blameable?: boolean, force: boolean = false) {
        if (blameable === undefined) {
            blameable = this._context.tracked && !this._context.dirty;
        }

        if (!force && this._context.blameable === blameable) return;

        this._context.blameable = blameable;

        setCommandContext(CommandContext.ActiveIsBlameable, blameable);
        this._onDidChangeBlameability.fire({
            blameable: blameable!,
            editor: this._context && this._context.editor,
            reason: reason
        });
    }

    private async updateRemotes(uri: GitUri | undefined) {
        const repositories = await this.git.getRepositories();

        let hasRemotes = false;
        if (uri !== undefined && this.git.isTrackable(uri)) {
            const remotes = await this.git.getRemotes(uri.repoPath);

            setCommandContext(CommandContext.ActiveHasRemotes, remotes.length !== 0);
        }
        else {
            if (repositories.length === 1) {
                const remotes = await this.git.getRemotes(repositories[0].path);
                hasRemotes = remotes.length !== 0;

                setCommandContext(CommandContext.ActiveHasRemotes, hasRemotes);
            }
            else {
                setCommandContext(CommandContext.ActiveHasRemotes, false);
            }
        }

        if (!hasRemotes) {
            for (const repo of repositories) {
                const remotes = await this.git.getRemotes(repo.path);
                hasRemotes = remotes.length !== 0;

                if (hasRemotes) break;
            }
        }

        setCommandContext(CommandContext.HasRemotes, hasRemotes);
    }
}