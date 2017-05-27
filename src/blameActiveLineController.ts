'use strict';
import { Functions, Objects } from './system';
import { DecorationInstanceRenderOptions, DecorationOptions, DecorationRenderOptions, Disposable, ExtensionContext, Range, StatusBarAlignment, StatusBarItem, TextEditor, TextEditorDecorationType, TextEditorSelectionChangeEvent, window, workspace } from 'vscode';
import { BlameAnnotationController } from './blameAnnotationController';
import { BlameAnnotationFormat, BlameAnnotationFormatter } from './blameAnnotationFormatter';
import { Commands } from './commands';
import { TextEditorComparer } from './comparers';
import { IBlameConfig, IConfig, StatusBarCommand } from './configuration';
import { DocumentSchemes, ExtensionKey } from './constants';
import { BlameabilityChangeEvent, GitCommit, GitContextTracker, GitService, GitUri, IGitCommitLine } from './gitService';
import * as moment from 'moment';

const activeLineDecoration: TextEditorDecorationType = window.createTextEditorDecorationType({
    after: {
        margin: '0 0 0 4em'
    }
} as DecorationRenderOptions);

export class BlameActiveLineController extends Disposable {

    private _activeEditorLineDisposable: Disposable | undefined;
    private _blameable: boolean;
    private _config: IConfig;
    private _currentLine: number = -1;
    private _disposable: Disposable;
    private _editor: TextEditor | undefined;
    private _statusBarItem: StatusBarItem | undefined;
    private _updateBlameDebounced: (line: number, editor: TextEditor) => Promise<void>;
    private _uri: GitUri;

    constructor(context: ExtensionContext, private git: GitService, private gitContextTracker: GitContextTracker, private annotationController: BlameAnnotationController) {
        super(() => this.dispose());

        this._updateBlameDebounced = Functions.debounce(this._updateBlame, 250);

        this._onConfigurationChanged();

        const subscriptions: Disposable[] = [];

        subscriptions.push(workspace.onDidChangeConfiguration(this._onConfigurationChanged, this));
        subscriptions.push(git.onDidChangeGitCache(this._onGitCacheChanged, this));
        subscriptions.push(annotationController.onDidToggleBlameAnnotations(this._onBlameAnnotationToggled, this));

        this._disposable = Disposable.from(...subscriptions);
    }

    dispose() {
        this._editor && this._editor.setDecorations(activeLineDecoration, []);

        this._activeEditorLineDisposable && this._activeEditorLineDisposable.dispose();
        this._statusBarItem && this._statusBarItem.dispose();
        this._disposable && this._disposable.dispose();
    }

    private _onConfigurationChanged() {
        const cfg = workspace.getConfiguration().get<IConfig>(ExtensionKey)!;

        let changed = false;

        if (!Objects.areEquivalent(cfg.statusBar, this._config && this._config.statusBar)) {
            changed = true;
            if (cfg.statusBar.enabled) {
                const alignment = cfg.statusBar.alignment !== 'left' ? StatusBarAlignment.Right : StatusBarAlignment.Left;
                if (this._statusBarItem !== undefined && this._statusBarItem.alignment !== alignment) {
                    this._statusBarItem.dispose();
                    this._statusBarItem = undefined;
                }

                this._statusBarItem = this._statusBarItem || window.createStatusBarItem(alignment, alignment === StatusBarAlignment.Right ? 1000 : 0);
                this._statusBarItem.command = cfg.statusBar.command;
            }
            else if (!cfg.statusBar.enabled && this._statusBarItem) {
                this._statusBarItem.dispose();
                this._statusBarItem = undefined;
            }
        }

        if (!Objects.areEquivalent(cfg.blame.annotation.activeLine, this._config && this._config.blame.annotation.activeLine)) {
            changed = true;
            if (cfg.blame.annotation.activeLine !== 'off' && this._editor) {
                this._editor.setDecorations(activeLineDecoration, []);
            }
        }
        if (!Objects.areEquivalent(cfg.blame.annotation.activeLineDarkColor, this._config && this._config.blame.annotation.activeLineDarkColor) ||
            !Objects.areEquivalent(cfg.blame.annotation.activeLineLightColor, this._config && this._config.blame.annotation.activeLineLightColor)) {
            changed = true;
        }

        this._config = cfg;

        if (!changed) return;

        const trackActiveLine = cfg.statusBar.enabled || cfg.blame.annotation.activeLine !== 'off';
        if (trackActiveLine && !this._activeEditorLineDisposable) {
            const subscriptions: Disposable[] = [];

            subscriptions.push(window.onDidChangeActiveTextEditor(this._onActiveTextEditorChanged, this));
            subscriptions.push(window.onDidChangeTextEditorSelection(this._onTextEditorSelectionChanged, this));
            subscriptions.push(this.gitContextTracker.onDidBlameabilityChange(this._onBlameabilityChanged, this));

            this._activeEditorLineDisposable = Disposable.from(...subscriptions);
        }
        else if (!trackActiveLine && this._activeEditorLineDisposable) {
            this._activeEditorLineDisposable.dispose();
            this._activeEditorLineDisposable = undefined;
        }

        this._onActiveTextEditorChanged(window.activeTextEditor);
    }

    private isEditorBlameable(editor: TextEditor | undefined): boolean {
        if (editor === undefined || editor.document === undefined) return false;

        if (!this.git.isTrackable(editor.document.uri)) return false;
        if (editor.document.isUntitled && editor.document.uri.scheme === DocumentSchemes.File) return false;

        return this.git.isEditorBlameable(editor);
    }

    private async _onActiveTextEditorChanged(editor: TextEditor | undefined) {
        this._currentLine = -1;

        const previousEditor = this._editor;
        previousEditor && previousEditor.setDecorations(activeLineDecoration, []);

        if (editor === undefined || !this.isEditorBlameable(editor)) {
            this.clear(editor);

            this._editor = undefined;

            return;
        }

        this._blameable = editor !== undefined && editor.document !== undefined && !editor.document.isDirty;
        this._editor = editor;
        this._uri = await GitUri.fromUri(editor.document.uri, this.git);

        const maxLines = this._config.advanced.caching.statusBar.maxLines;
        // If caching is on and the file is small enough -- kick off a blame for the whole file
        if (this._config.advanced.caching.enabled && (maxLines <= 0 || editor.document.lineCount <= maxLines)) {
            this.git.getBlameForFile(this._uri);
        }

        this._updateBlameDebounced(editor.selection.active.line, editor);
    }

    private _onBlameabilityChanged(e: BlameabilityChangeEvent) {
        this._blameable = e.blameable;
        if (!e.blameable || !this._editor) {
            this.clear(e.editor);
            return;
        }

        // Make sure this is for the editor we are tracking
        if (!TextEditorComparer.equals(this._editor, e.editor)) return;

        this._updateBlameDebounced(this._editor.selection.active.line, this._editor);
    }

    private _onBlameAnnotationToggled() {
        this._onActiveTextEditorChanged(window.activeTextEditor);
    }

    private _onGitCacheChanged() {
        this._onActiveTextEditorChanged(window.activeTextEditor);
    }

    private async _onTextEditorSelectionChanged(e: TextEditorSelectionChangeEvent): Promise<void> {
        // Make sure this is for the editor we are tracking
        if (!this._blameable || !TextEditorComparer.equals(this._editor, e.textEditor)) return;

        const line = e.selections[0].active.line;
        if (line === this._currentLine) return;
        this._currentLine = line;

        if (!this._uri && e.textEditor) {
            this._uri = await GitUri.fromUri(e.textEditor.document.uri, this.git);
        }

        this._updateBlameDebounced(line, e.textEditor);
    }

    private async _updateBlame(line: number, editor: TextEditor) {
        line = line - this._uri.offset;

        let commit: GitCommit | undefined = undefined;
        let commitLine: IGitCommitLine | undefined = undefined;
        // Since blame information isn't valid when there are unsaved changes -- don't show any status
        if (this._blameable && line >= 0) {
            const blameLine = await this.git.getBlameForLine(this._uri, line);
            commitLine = blameLine === undefined ? undefined : blameLine.line;
            commit = blameLine === undefined ? undefined : blameLine.commit;
        }

        if (commit !== undefined && commitLine !== undefined) {
            this.show(commit, commitLine, editor);
        }
        else {
            this.clear(editor);
        }
    }

    clear(editor: TextEditor | undefined, previousEditor?: TextEditor) {
        editor && editor.setDecorations(activeLineDecoration, []);
        // I have no idea why the decorators sometimes don't get removed, but if they don't try again with a tiny delay
        if (editor) {
            setTimeout(() => editor.setDecorations(activeLineDecoration, []), 1);
        }

        this._statusBarItem && this._statusBarItem.hide();
    }

    async show(commit: GitCommit, blameLine: IGitCommitLine, editor: TextEditor) {
        // I have no idea why I need this protection -- but it happens
        if (!editor.document) return;

        if (this._config.statusBar.enabled && this._statusBarItem !== undefined) {
            switch (this._config.statusBar.date) {
                case 'off':
                    this._statusBarItem.text = `$(git-commit) ${commit.author}`;
                    break;
                case 'absolute':
                    const dateFormat = this._config.statusBar.dateFormat || 'MMMM Do, YYYY h:MMa';
                    let date: string;
                    try {
                        date = moment(commit.date).format(dateFormat);
                    } catch (ex) {
                        date = moment(commit.date).format('MMMM Do, YYYY h:MMa');
                    }
                    this._statusBarItem.text = `$(git-commit) ${commit.author}, ${date}`;
                    break;
                default:
                    this._statusBarItem.text = `$(git-commit) ${commit.author}, ${moment(commit.date).fromNow()}`;
                    break;
            }

            switch (this._config.statusBar.command) {
                case StatusBarCommand.BlameAnnotate:
                    this._statusBarItem.tooltip = 'Toggle Blame Annotations';
                    break;
                case StatusBarCommand.ShowBlameHistory:
                    this._statusBarItem.tooltip = 'Open Blame History Explorer';
                    break;
                case StatusBarCommand.ShowFileHistory:
                    this._statusBarItem.tooltip = 'Open File History Explorer';
                    break;
                case StatusBarCommand.DiffWithPrevious:
                    this._statusBarItem.command = Commands.DiffLineWithPrevious;
                    this._statusBarItem.tooltip = 'Compare File with Previous';
                    break;
                case StatusBarCommand.DiffWithWorking:
                    this._statusBarItem.command = Commands.DiffLineWithWorking;
                    this._statusBarItem.tooltip = 'Compare File with Working Tree';
                    break;
                case StatusBarCommand.ToggleCodeLens:
                    this._statusBarItem.tooltip = 'Toggle Git CodeLens';
                    break;
                case StatusBarCommand.ShowQuickCommitDetails:
                    this._statusBarItem.tooltip = 'Show Commit Details';
                    break;
                case StatusBarCommand.ShowQuickCommitFileDetails:
                    this._statusBarItem.tooltip = 'Show Line Commit Details';
                    break;
                case StatusBarCommand.ShowQuickFileHistory:
                    this._statusBarItem.tooltip = 'Show File History';
                    break;
                case StatusBarCommand.ShowQuickCurrentBranchHistory:
                    this._statusBarItem.tooltip = 'Show Branch History';
                    break;
            }

            this._statusBarItem.show();
        }

        if (this._config.blame.annotation.activeLine !== 'off') {
            const activeLine = this._config.blame.annotation.activeLine;
            const offset = this._uri.offset;

            const cfg = {
                annotation: {
                    sha: true,
                    author: this._config.statusBar.enabled ? false : this._config.blame.annotation.author,
                    date: this._config.statusBar.enabled ? 'off' : this._config.blame.annotation.date,
                    message: true
                }
            } as IBlameConfig;

            const annotation = BlameAnnotationFormatter.getAnnotation(cfg, commit, BlameAnnotationFormat.Unconstrained);

            // Get the full commit message -- since blame only returns the summary
            let logCommit: GitCommit | undefined = undefined;
            if (!commit.isUncommitted) {
                logCommit = await this.git.getLogCommit(this._uri.repoPath, this._uri.fsPath, commit.sha);
            }

            // I have no idea why I need this protection -- but it happens
            if (!editor.document) return;

            let hoverMessage: string | string[] | undefined = undefined;
            if (activeLine !== 'inline') {
                // If the messages match (or we couldn't find the log), then this is a possible duplicate annotation
                const possibleDuplicate = !logCommit || logCommit.message === commit.message;
                // If we don't have a possible dupe or we aren't showing annotations get the hover message
                if (!commit.isUncommitted && (!possibleDuplicate || !this.annotationController.isAnnotating(editor))) {
                    hoverMessage = BlameAnnotationFormatter.getAnnotationHover(cfg, blameLine, logCommit || commit);

                    if (commit.previousSha !== undefined) {
                        const changes = await this.git.getDiffForLine(this._uri, blameLine.line + offset, commit.previousSha);
                        if (changes !== undefined) {
                            let previous = changes[0];
                            if (previous !== undefined) {
                                previous = previous.replace(/\n/g, '\`\n>\n> \`').trim();
                                hoverMessage += `\n\n---\n\`\`\`\n${previous}\n\`\`\``;
                            }
                        }
                    }
                }
                else if (commit.isUncommitted) {
                    const changes = await this.git.getDiffForLine(this._uri, blameLine.line + offset);
                    if (changes !== undefined) {
                        let previous = changes[0];
                        if (previous !== undefined) {
                            previous = previous.replace(/\n/g, '\`\n>\n> \`').trim();
                            hoverMessage = `\`${'0'.repeat(8)}\` &nbsp; __Uncommitted change__\n\n---\n\`\`\`\n${previous}\n\`\`\``;
                        }
                    }
                }
            }

            let decorationOptions: [DecorationOptions] | undefined = undefined;
            switch (activeLine) {
                case 'both':
                case 'inline':
                    const range = editor.document.validateRange(new Range(blameLine.line + offset, 0, blameLine.line + offset, 1000000));
                    decorationOptions = [
                        {
                            range: range.with({
                                start: range.start.with({
                                    character: range.end.character
                                })
                            }),
                            hoverMessage: hoverMessage,
                            renderOptions: {
                                after: {
                                    contentText: annotation
                                },
                                dark: {
                                    after: {
                                        color: this._config.blame.annotation.activeLineDarkColor || 'rgba(153, 153, 153, 0.35)'
                                    }
                                },
                                light: {
                                    after: {
                                        color: this._config.blame.annotation.activeLineLightColor || 'rgba(153, 153, 153, 0.35)'
                                    }
                                }
                            } as DecorationInstanceRenderOptions
                        } as DecorationOptions
                    ];

                    if (activeLine === 'both') {
                        // Add a hover decoration to the area between the start of the line and the first non-whitespace character
                        decorationOptions.push({
                            range: range.with({
                                end: range.end.with({
                                    character: editor.document.lineAt(range.end.line).firstNonWhitespaceCharacterIndex
                                })
                            }),
                            hoverMessage: hoverMessage
                        } as DecorationOptions);
                    }

                    break;

                case 'hover':
                    decorationOptions = [
                        {
                            range: editor.document.validateRange(new Range(blameLine.line + offset, 0, blameLine.line + offset, 1000000)),
                            hoverMessage: hoverMessage
                        } as DecorationOptions
                    ];

                    break;
            }

            if (decorationOptions !== undefined) {
                editor.setDecorations(activeLineDecoration, decorationOptions);
            }
        }
    }
}