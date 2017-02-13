'use strict';
import { Iterables } from './system';
import { DecorationInstanceRenderOptions, DecorationOptions, DecorationRenderOptions, Disposable, ExtensionContext, OverviewRulerLane, Range, TextDocument, TextEditor, TextEditorDecorationType, TextEditorSelectionChangeEvent, window, workspace } from 'vscode';
import BlameAnnotationFormatter, { BlameAnnotationFormat, cssIndent, defaultShaLength, defaultAuthorLength } from './blameAnnotationFormatter';
import { TextDocumentComparer } from './comparers';
import { BlameAnnotationStyle, IBlameConfig } from './configuration';
import GitProvider, { GitUri, IGitBlame } from './gitProvider';
import WhitespaceController from './whitespaceController';

const blameDecoration: TextEditorDecorationType = window.createTextEditorDecorationType({
    before: {
        margin: '0 1.75em 0 0'
    },
    after: {
        margin: '0 0 0 4em'
    }
} as DecorationRenderOptions);

let highlightDecoration: TextEditorDecorationType;

export class BlameAnnotationProvider extends Disposable {

    public document: TextDocument;

    private _blame: Promise<IGitBlame>;
    private _config: IBlameConfig;
    private _disposable: Disposable;
    private _uri: GitUri;

    constructor(context: ExtensionContext, private git: GitProvider, private whitespaceController: WhitespaceController | undefined, public editor: TextEditor) {
        super(() => this.dispose());

        if (!highlightDecoration) {
            highlightDecoration = window.createTextEditorDecorationType({
                dark: {
                    backgroundColor: 'rgba(255, 255, 255, 0.15)',
                    gutterIconPath: context.asAbsolutePath('images/blame-dark.svg'),
                    overviewRulerColor: 'rgba(255, 255, 255, 0.75)'
                },
                light: {
                    backgroundColor: 'rgba(0, 0, 0, 0.15)',
                    gutterIconPath: context.asAbsolutePath('images/blame-light.svg'),
                    overviewRulerColor: 'rgba(0, 0, 0, 0.75)'
                },
                gutterIconSize: 'contain',
                overviewRulerLane: OverviewRulerLane.Right,
                isWholeLine: true
            });
        }

        this.document = this.editor.document;
        this._uri = GitUri.fromUri(this.document.uri, this.git);

        this._blame = this.git.getBlameForFile(this._uri.fsPath, this._uri.sha, this._uri.repoPath);

        this._config = workspace.getConfiguration('gitlens').get<IBlameConfig>('blame');

        const subscriptions: Disposable[] = [];

        subscriptions.push(window.onDidChangeTextEditorSelection(this._onActiveSelectionChanged, this));

        this._disposable = Disposable.from(...subscriptions);
    }

    async dispose() {
        if (this.editor) {
            this.editor.setDecorations(blameDecoration, []);
            this.editor.setDecorations(highlightDecoration, []);
        }

        // HACK: Until https://github.com/Microsoft/vscode/issues/11485 is fixed -- restore whitespace
        this.whitespaceController && await this.whitespaceController.restore();

        this._disposable && this._disposable.dispose();
    }

    private async _onActiveSelectionChanged(e: TextEditorSelectionChangeEvent) {
        if (!TextDocumentComparer.equals(this.document, e.textEditor && e.textEditor.document)) return;

        return this.setSelection(e.selections[0].active.line);
    }

    async supportsBlame(): Promise<boolean> {
        const blame = await this._blame;
        return !!(blame && blame.lines.length);
    }

    async provideBlameAnnotation(shaOrLine?: string | number): Promise<boolean> {
        const blame = await this._blame;
        if (!blame || !blame.lines.length) return false;

        // HACK: Until https://github.com/Microsoft/vscode/issues/11485 is fixed -- override whitespace (turn off)
        if (this._config.annotation.style !== BlameAnnotationStyle.Trailing) {
            this.whitespaceController && await this.whitespaceController.override();
        }

        let blameDecorationOptions: DecorationOptions[] | undefined;
        switch (this._config.annotation.style) {
            case BlameAnnotationStyle.Compact:
                blameDecorationOptions = this._getCompactGutterDecorations(blame);
                break;
            case BlameAnnotationStyle.Expanded:
                blameDecorationOptions = this._getExpandedGutterDecorations(blame, false);
                break;
            case BlameAnnotationStyle.Trailing:
                blameDecorationOptions = this._getExpandedGutterDecorations(blame, true);
                break;
        }

        if (blameDecorationOptions) {
            this.editor.setDecorations(blameDecoration, blameDecorationOptions);
        }

        this._setSelection(blame, shaOrLine);
        return true;
    }

    async setSelection(shaOrLine?: string | number) {
        const blame = await this._blame;
        if (!blame || !blame.lines.length) return;

        return this._setSelection(blame, shaOrLine);
    }

    private _setSelection(blame: IGitBlame, shaOrLine?: string | number) {
        const offset = this._uri.offset;

        let sha: string;
        if (typeof shaOrLine === 'string') {
            sha = shaOrLine;
        }
        else if (typeof shaOrLine === 'number') {
            const line = shaOrLine - offset;
            if (line >= 0) {
                const commitLine = blame.lines[line];
                sha = commitLine && commitLine.sha;
            }
        }
        else {
            sha = Iterables.first(blame.commits.values()).sha;
        }

        if (!sha) {
            this.editor.setDecorations(highlightDecoration, []);
            return;
        }

        const highlightDecorationRanges = blame.lines
            .filter(l => l.sha === sha)
            .map(l => this.editor.document.validateRange(new Range(l.line + offset, 0, l.line + offset, 1000000)));

        this.editor.setDecorations(highlightDecoration, highlightDecorationRanges);
    }

    private _getCompactGutterDecorations(blame: IGitBlame): DecorationOptions[] {
        const offset = this._uri.offset;

        let count = 0;
        let lastSha: string;
        return blame.lines.map(l => {
            let commit = blame.commits.get(l.sha);

            let color: string;
            if (commit.isUncommitted) {
                color = 'rgba(0, 188, 242, 0.6)';
            }
            else {
                color = l.previousSha ? '#999999' : '#6b6b6b';
            }

            let gutter = '';
            if (lastSha !== l.sha) {
                count = -1;
            }

            const isEmptyOrWhitespace = this.document.lineAt(l.line).isEmptyOrWhitespace;
            if (!isEmptyOrWhitespace) {
                switch (++count) {
                    case 0:
                        gutter = commit.sha.substring(0, defaultShaLength);
                        break;
                    case 1:
                        gutter = `${cssIndent} ${BlameAnnotationFormatter.getAuthor(this._config, commit, defaultAuthorLength, true)}`;
                        break;
                    case 2:
                        gutter = `${cssIndent} ${BlameAnnotationFormatter.getDate(this._config, commit, 'MM/DD/YYYY', true, true)}`;
                        break;
                    default:
                        gutter = `${cssIndent}`;
                        break;
                }
            }

            const hoverMessage = BlameAnnotationFormatter.getAnnotationHover(this._config, l, commit);

            // Escape single quotes because for some reason that breaks the ::before or ::after element
            // https://github.com/Microsoft/vscode/issues/19922 remove once this is released
            gutter = gutter.replace(/\'/g, '\\\'');

            lastSha = l.sha;

            return {
                range: this.editor.document.validateRange(new Range(l.line + offset, 0, l.line + offset, 1000000)),
                hoverMessage: hoverMessage,
                renderOptions: {
                    before: {
                        color: color,
                        contentText: gutter,
                        width: '11em'
                    }
                }
            } as DecorationOptions;
        });
    }

    private _getExpandedGutterDecorations(blame: IGitBlame, trailing: boolean = false): DecorationOptions[] {
        const offset = this._uri.offset;

        let width = 0;
        if (!trailing) {
            if (this._config.annotation.sha) {
                width += 5;
            }
            if (this._config.annotation.date && this._config.annotation.date !== 'off') {
                if (width > 0) {
                    width += 7;
                }
                else {
                    width += 6;
                }

                if (this._config.annotation.date === 'relative') {
                    width += 2;
                }
            }
            if (this._config.annotation.author) {
                if (width > 5 + 6) {
                    width += 12;
                }
                else if (width > 0) {
                    width += 11;
                }
                else {
                    width += 10;
                }
            }
            if (this._config.annotation.message) {
                if (width > 5 + 6 + 10) {
                    width += 21;
                }
                else if (width > 5 + 6) {
                    width += 21;
                }
                else if (width > 0) {
                    width += 21;
                }
                else {
                    width += 19;
                }
            }
        }

        return blame.lines.map(l => {
            let commit = blame.commits.get(l.sha);

            let color: string;
            if (commit.isUncommitted) {
                color = 'rgba(0, 188, 242, 0.6)';
            }
            else {
                if (trailing) {
                    color = l.previousSha ? 'rgba(153, 153, 153, 0.5)' : 'rgba(107, 107, 107, 0.5)';
                }
                else {
                    color = l.previousSha ? 'rgb(153, 153, 153)' : 'rgb(107, 107, 107)';
                }
            }

            const format = trailing ? BlameAnnotationFormat.Unconstrained : BlameAnnotationFormat.Constrained;
            // Escape single quotes because for some reason that breaks the ::before or ::after element
            // https://github.com/Microsoft/vscode/issues/19922 remove once this is released
            const gutter = BlameAnnotationFormatter.getAnnotation(this._config, commit, format).replace(/\'/g, '\\\'');
            const hoverMessage = BlameAnnotationFormatter.getAnnotationHover(this._config, l, commit);

            let renderOptions: DecorationInstanceRenderOptions;
            if (trailing) {
                renderOptions = {
                    after: {
                        color: color,
                        contentText: gutter
                    }
                } as DecorationInstanceRenderOptions;
            }
            else {
                renderOptions = {
                    before: {
                        color: color,
                        contentText: gutter,
                        width: `${width}em`
                    }
                } as DecorationInstanceRenderOptions;
            }

            return {
                range: this.editor.document.validateRange(new Range(l.line + offset, 0, l.line + offset, 1000000)),
                hoverMessage: hoverMessage,
                renderOptions: renderOptions
            } as DecorationOptions;
        });
    }
}