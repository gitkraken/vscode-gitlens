import { Dates, Objects, Strings } from '../system';
import { DecorationInstanceRenderOptions, DecorationOptions, MarkdownString, ThemableDecorationRenderOptions, ThemeColor, window } from 'vscode';
import { FileAnnotationType } from './annotationController';
import { DiffWithCommand, OpenCommitInRemoteCommand, OpenFileRevisionCommand, ShowQuickCommitDetailsCommand, ShowQuickCommitFileDetailsCommand } from '../commands';
import { GlyphChars } from '../constants';
import { CommitFormatter, GitCommit, GitDiffChunkLine, GitService, GitUri, ICommitFormatOptions } from '../gitService';

interface IHeatmapConfig {
    enabled: boolean;
    location?: 'left' | 'right';
}

interface IRenderOptions extends DecorationInstanceRenderOptions, ThemableDecorationRenderOptions {
    height?: string;
    uncommittedColor?: string | ThemeColor;
}

export const endOfLineIndex = 1000000;
const escapeMarkdownRegEx = /[`\>\#\*\_\-\+\.]/g;
// const sampleMarkdown = '## message `not code` *not important* _no underline_ \n> don\'t quote me \n- don\'t list me \n+ don\'t list me \n1. don\'t list me \nnot h1 \n=== \nnot h2 \n---\n***\n---\n___';

export class Annotations {

    static applyHeatmap(decoration: DecorationOptions, date: Date, now: number) {
        const color = this.getHeatmapColor(now, date);
        (decoration.renderOptions!.before! as any).borderColor = color;
    }

    private static getHeatmapColor(now: number, date: Date) {
        const days = Dates.dateDaysFromNow(date, now);

        if (days <= 2) return '#ffeca7';
        if (days <= 7) return '#ffdd8c';
        if (days <= 14) return '#ffdd7c';
        if (days <= 30) return '#fba447';
        if (days <= 60) return '#f68736';
        if (days <= 90) return '#f37636';
        if (days <= 180) return '#ca6632';
        if (days <= 365) return '#c0513f';
        if (days <= 730) return '#a2503a';
        return '#793738';
    }

    private static getHoverCommandBar(commit: GitCommit, hasRemote: boolean, annotationType?: FileAnnotationType) {
        let commandBar = `[\`${GlyphChars.DoubleArrowLeft}\`](${DiffWithCommand.getMarkdownCommandArgs(commit)} "Open Changes") `;

        if (commit.previousSha !== undefined) {
            if (annotationType === FileAnnotationType.RecentChanges) {
                annotationType = FileAnnotationType.Gutter;
            }

            const uri = GitUri.toRevisionUri(commit.previousSha, commit.previousUri.fsPath, commit.repoPath);
            const line = window.activeTextEditor!.selection.active.line;

            commandBar += `[\`${GlyphChars.SquareWithTopShadow}\`](${OpenFileRevisionCommand.getMarkdownCommandArgs(uri, annotationType || FileAnnotationType.Gutter, line)} "Blame Previous Revision") `;
        }

        if (hasRemote) {
            commandBar += `[\`${GlyphChars.ArrowUpRight}\`](${OpenCommitInRemoteCommand.getMarkdownCommandArgs(commit.sha)} "Open in Remote") `;
        }

        commandBar += `[\`${GlyphChars.MiddleEllipsis}\`](${ShowQuickCommitFileDetailsCommand.getMarkdownCommandArgs(commit.sha)} "Show More Actions")`;

        return commandBar;
    }

    static getHoverMessage(commit: GitCommit, dateFormat: string | null, hasRemote: boolean, annotationType?: FileAnnotationType): MarkdownString {
        if (dateFormat === null) {
            dateFormat = 'MMMM Do, YYYY h:MMa';
        }

        let message = '';
        let commandBar = '';
        let showCommitDetailsCommand = '';
        if (!commit.isUncommitted) {
            commandBar = `\n\n${this.getHoverCommandBar(commit, hasRemote, annotationType)}`;
            showCommitDetailsCommand = `[\`${commit.shortSha}\`](${ShowQuickCommitDetailsCommand.getMarkdownCommandArgs(commit.sha)} "Show Commit Details")`;

            message = commit.message
                // Escape markdown
                .replace(escapeMarkdownRegEx, '\\$&')
                // Escape markdown header (since the above regex won't match it)
                .replace(/^===/gm, `${GlyphChars.ZeroWidthSpace}===`)
                // Keep under the same block-quote
                .replace(/\n/g, '  \n');
            message = `\n\n> ${message}`;
        }
        else {
            showCommitDetailsCommand = `\`${commit.shortSha}\``;
        }

        const markdown = new MarkdownString(`${showCommitDetailsCommand} &nbsp; __${commit.author}__, ${commit.fromNow()} &nbsp; _(${commit.formatDate(dateFormat)})_ ${message}${commandBar}`);
        markdown.isTrusted = true;
        return markdown;
    }

    static getHoverDiffMessage(commit: GitCommit, uri: GitUri, chunkLine: GitDiffChunkLine | undefined): MarkdownString | undefined {
        if (chunkLine === undefined || commit.previousSha === undefined) return undefined;

        const codeDiff = this.getCodeDiff(chunkLine);

        let message: string;
        if (commit.isUncommitted) {
            if (uri.sha !== undefined && GitService.isStagedUncommitted(uri.sha)) {
                message = `[\`Changes\`](${DiffWithCommand.getMarkdownCommandArgs(commit)} "Open Changes") &nbsp; ${GlyphChars.Dash} &nbsp; [\`${commit.previousShortSha}\`](${ShowQuickCommitDetailsCommand.getMarkdownCommandArgs(commit.previousSha!)} "Show Commit Details") ${GlyphChars.ArrowLeftRight} _${uri.shortSha}_\n${codeDiff}`;
            }
            else {
                message = `[\`Changes\`](${DiffWithCommand.getMarkdownCommandArgs(commit)} "Open Changes") &nbsp; ${GlyphChars.Dash} &nbsp; _uncommitted_\n${codeDiff}`;
            }
        }
        else {
            message = `[\`Changes\`](${DiffWithCommand.getMarkdownCommandArgs(commit)} "Open Changes") &nbsp; ${GlyphChars.Dash} &nbsp; [\`${commit.previousShortSha}\`](${ShowQuickCommitDetailsCommand.getMarkdownCommandArgs(commit.previousSha!)} "Show Commit Details") ${GlyphChars.ArrowLeftRight} [\`${commit.shortSha}\`](${ShowQuickCommitDetailsCommand.getMarkdownCommandArgs(commit.sha)} "Show Commit Details")\n${codeDiff}`;
        }

        const markdown = new MarkdownString(message);
        markdown.isTrusted = true;
        return markdown;
    }

    private static getCodeDiff(chunkLine: GitDiffChunkLine): string {
        const previous = chunkLine.previous === undefined ? undefined : chunkLine.previous[0];
        return `\`\`\`
-  ${previous === undefined || previous.line === undefined ? '' : previous.line.trim()}
+  ${chunkLine.line === undefined ? '' : chunkLine.line.trim()}
\`\`\``;
    }

    static async changesHover(commit: GitCommit, line: number, uri: GitUri, git: GitService): Promise<DecorationOptions> {
        const sha = !commit.isUncommitted || (uri.sha !== undefined && GitService.isStagedUncommitted(uri.sha))
            ? commit.previousSha
            : undefined;
        const chunkLine = await git.getDiffForLine(uri, line, sha);
        const message = this.getHoverDiffMessage(commit, uri, chunkLine);

        return {
            hoverMessage: message
        } as DecorationOptions;
    }

    static detailsHover(commit: GitCommit, dateFormat: string | null, hasRemote: boolean, annotationType?: FileAnnotationType): DecorationOptions {
        const message = this.getHoverMessage(commit, dateFormat, hasRemote, annotationType);
        return {
            hoverMessage: message
        } as DecorationOptions;
    }

    static gutter(commit: GitCommit, format: string, dateFormatOrFormatOptions: string | null | ICommitFormatOptions, renderOptions: IRenderOptions): DecorationOptions {
        const decoration = {
            renderOptions: {
                before: { ...renderOptions }
            } as DecorationInstanceRenderOptions
        } as DecorationOptions;

        if (commit.isUncommitted) {
            decoration.renderOptions!.before!.color = renderOptions.uncommittedColor;
        }

        const message = CommitFormatter.fromTemplate(format, commit, dateFormatOrFormatOptions);
        decoration.renderOptions!.before!.contentText = Strings.pad(message.replace(/ /g, GlyphChars.Space), 1, 1);

        return decoration;
    }

    static gutterRenderOptions(separateLines: boolean, heatmap: IHeatmapConfig, format: string, options: ICommitFormatOptions): IRenderOptions {
        // Get the width of all the tokens, assuming there there is a cap (bail if not)
        let width = 0;
        for (const token of Objects.values(options.tokenOptions!)) {
            if (token === undefined) continue;

            // If any token is uncapped, kick out and set no max
            if (token.truncateTo == null) {
                width = -1;
                break;
            }

            width += token.truncateTo;
        }

        if (width >= 0) {
            // Add the width of the template string (without tokens)
            width += Strings.width(Strings.interpolate(format, undefined));
            // If we have some width, add a bit of padding
            if (width > 0) {
                width += 3;
            }
        }

        let borderStyle = undefined;
        let borderWidth = undefined;
        if (heatmap.enabled) {
            borderStyle = 'solid';
            borderWidth = heatmap.location === 'left' ? '0 0 0 2px' : '0 2px 0 0';
        }

        return {
            backgroundColor: new ThemeColor('gitlens.gutterBackgroundColor'),
            borderStyle: borderStyle,
            borderWidth: borderWidth,
            color: new ThemeColor('gitlens.gutterForegroundColor'),
            height: '100%',
            margin: '0 26px -1px 0',
            textDecoration: separateLines ? 'overline solid rgba(0, 0, 0, .2)' : 'none',
            width: width >= 0 ? `${width}ch` : undefined,
            uncommittedColor: new ThemeColor('gitlens.gutterUncommittedForegroundColor')
        } as IRenderOptions;
    }

    static hover(commit: GitCommit, renderOptions: IRenderOptions, now: number): DecorationOptions {
        const decoration = {
            renderOptions: { before: { ...renderOptions } }
        } as DecorationOptions;

        this.applyHeatmap(decoration, commit.date, now);

        return decoration;
    }

    static hoverRenderOptions(heatmap: IHeatmapConfig): IRenderOptions {
        if (!heatmap.enabled) return { before: undefined };

        return {
            borderStyle: 'solid',
            borderWidth: '0 0 0 2px',
            contentText: GlyphChars.ZeroWidthSpace,
            height: '100%',
            margin: '0 26px 0 0',
            textDecoration: 'none'
        } as IRenderOptions;
    }

    static trailing(commit: GitCommit, format: string, dateFormat: string | null): DecorationOptions {
        const message = CommitFormatter.fromTemplate(format, commit, {
            truncateMessageAtNewLine: true,
            dateFormat: dateFormat
        } as ICommitFormatOptions);

        return {
            renderOptions: {
                after: {
                    backgroundColor: new ThemeColor('gitlens.trailingLineBackgroundColor'),
                    color: new ThemeColor('gitlens.trailingLineForegroundColor'),
                    contentText: Strings.pad(message.replace(/ /g, GlyphChars.Space), 1, 1)
                }
            } as DecorationInstanceRenderOptions
        } as DecorationOptions;
    }

    static withRange(decoration: DecorationOptions, start?: number, end?: number): DecorationOptions {
        let range = decoration.range;
        if (start !== undefined) {
            range = range.with({
                start: range.start.with({ character: start })
            });
        }

        if (end !== undefined) {
            range = range.with({
                end: range.end.with({ character: end })
            });
        }

        return { ...decoration, ...{ range: range } };
    }
}