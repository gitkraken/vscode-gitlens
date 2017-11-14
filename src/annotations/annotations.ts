import { Dates, Objects, Strings } from '../system';
import { DecorationInstanceRenderOptions, DecorationOptions, MarkdownString, ThemableDecorationRenderOptions, window } from 'vscode';
import { FileAnnotationType } from './annotationController';
import { DiffWithCommand, OpenCommitInRemoteCommand, OpenFileRevisionCommand, ShowQuickCommitDetailsCommand, ShowQuickCommitFileDetailsCommand } from '../commands';
import { IThemeConfig, themeDefaults } from '../configuration';
import { GlyphChars } from '../constants';
import { CommitFormatter, GitCommit, GitDiffChunkLine, GitService, GitUri, ICommitFormatOptions } from '../gitService';

interface IHeatmapConfig {
    enabled: boolean;
    location?: 'left' | 'right';
}

interface IRenderOptions {
    uncommittedForegroundColor?: {
        dark: string;
        light: string;
    };

    before?: DecorationInstanceRenderOptions & ThemableDecorationRenderOptions & { height?: string };
    dark?: DecorationInstanceRenderOptions;
    light?: DecorationInstanceRenderOptions;
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

            const uri = GitService.toGitContentUri(commit.previousSha, commit.previousUri.fsPath, commit.repoPath);
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

    static getHoverDiffMessage(commit: GitCommit, chunkLine: GitDiffChunkLine | undefined): MarkdownString | undefined {
        if (chunkLine === undefined || commit.previousSha === undefined) return undefined;

        const codeDiff = this.getCodeDiff(chunkLine);
        const markdown = new MarkdownString(commit.isUncommitted
            ? `[\`Changes\`](${DiffWithCommand.getMarkdownCommandArgs(commit)} "Open Changes") &nbsp; ${GlyphChars.Dash} &nbsp; _uncommitted_\n${codeDiff}`
            : `[\`Changes\`](${DiffWithCommand.getMarkdownCommandArgs(commit)} "Open Changes") &nbsp; ${GlyphChars.Dash} &nbsp; [\`${commit.previousShortSha}\`](${ShowQuickCommitDetailsCommand.getMarkdownCommandArgs(commit.previousSha!)} "Show Commit Details") ${GlyphChars.ArrowLeftRight} [\`${commit.shortSha}\`](${ShowQuickCommitDetailsCommand.getMarkdownCommandArgs(commit.sha)} "Show Commit Details")\n${codeDiff}`);
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
        const chunkLine = await git.getDiffForLine(uri, line, commit.isUncommitted ? undefined : commit.previousSha);
        const message = this.getHoverDiffMessage(commit, chunkLine);

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
        const message = CommitFormatter.fromTemplate(format, commit, dateFormatOrFormatOptions);

        return {
            renderOptions: {
                before: {
                    ...renderOptions.before,
                    ...{
                        contentText: Strings.pad(message.replace(/ /g, GlyphChars.Space), 1, 1)
                    }
                },
                dark: {
                    before: commit.isUncommitted
                        ? { ...renderOptions.dark, ...{ color: renderOptions.uncommittedForegroundColor!.dark } }
                        : { ...renderOptions.dark }
                },
                light: {
                    before: commit.isUncommitted
                        ? { ...renderOptions.light, ...{ color: renderOptions.uncommittedForegroundColor!.light } }
                        : { ...renderOptions.light }
                }
            } as DecorationInstanceRenderOptions
        } as DecorationOptions;
    }

    static gutterRenderOptions(cfgTheme: IThemeConfig, heatmap: IHeatmapConfig, options: ICommitFormatOptions): IRenderOptions {
        const cfgFileTheme = cfgTheme.annotations.file.gutter;

        // Try to get the width of the string, if there is a cap
        let width = 4; // Start with a padding
        for (const token of Objects.values(options.tokenOptions!)) {
            if (token === undefined) continue;

            // If any token is uncapped, kick out and set no max
            if (token.truncateTo == null) {
                width = 0;
                break;
            }

            width += token.truncateTo;
        }

        let borderStyle = undefined;
        let borderWidth = undefined;
        if (heatmap.enabled) {
            borderStyle = 'solid';
            borderWidth = heatmap.location === 'left' ? '0 0 0 2px' : '0 2px 0 0';
        }

        return {
            uncommittedForegroundColor: {
                dark: cfgFileTheme.dark.uncommittedForegroundColor || cfgFileTheme.dark.foregroundColor || themeDefaults.annotations.file.gutter.dark.foregroundColor,
                light: cfgFileTheme.light.uncommittedForegroundColor || cfgFileTheme.light.foregroundColor || themeDefaults.annotations.file.gutter.light.foregroundColor
            },
            before: {
                borderStyle: borderStyle,
                borderWidth: borderWidth,
                height: '100%',
                margin: '0 26px -1px 0',
                width: (width > 4) ? `${width}ch` : undefined
            },
            dark: {
                backgroundColor: cfgFileTheme.dark.backgroundColor || undefined,
                color: cfgFileTheme.dark.foregroundColor || themeDefaults.annotations.file.gutter.dark.foregroundColor,
                textDecoration: cfgFileTheme.separateLines ? 'overline solid rgba(0, 0, 0, .2)' : 'none'
            } as DecorationInstanceRenderOptions,
            light: {
                backgroundColor: cfgFileTheme.light.backgroundColor || undefined,
                color: cfgFileTheme.light.foregroundColor || themeDefaults.annotations.file.gutter.light.foregroundColor,
                textDecoration: cfgFileTheme.separateLines ? 'overline solid rgba(0, 0, 0, .05)' : 'none'
            } as DecorationInstanceRenderOptions
        } as IRenderOptions;
    }

    static hover(commit: GitCommit, renderOptions: IRenderOptions, now: number): DecorationOptions {
        const decoration = {
            renderOptions: { before: { ...renderOptions.before } }
        } as DecorationOptions;
        this.applyHeatmap(decoration, commit.date, now);
        return decoration;
    }

    static hoverRenderOptions(cfgTheme: IThemeConfig, heatmap: IHeatmapConfig): IRenderOptions {
        if (!heatmap.enabled) return { before: undefined };

        return {
            before: {
                borderStyle: 'solid',
                borderWidth: '0 0 0 2px',
                contentText: GlyphChars.ZeroWidthSpace,
                height: '100%',
                margin: '0 26px 0 0',
                textDecoration: 'none'
            }
        } as IRenderOptions;
    }

    static trailing(commit: GitCommit, format: string, dateFormat: string | null, cfgTheme: IThemeConfig): DecorationOptions {
        const message = CommitFormatter.fromTemplate(format, commit, {
            truncateMessageAtNewLine: true,
            dateFormat: dateFormat
        } as ICommitFormatOptions);

        return {
            renderOptions: {
                after: {
                    contentText: Strings.pad(message.replace(/ /g, GlyphChars.Space), 1, 1)
                },
                dark: {
                    after: {
                        backgroundColor: cfgTheme.annotations.line.trailing.dark.backgroundColor || undefined,
                        color: cfgTheme.annotations.line.trailing.dark.foregroundColor || themeDefaults.annotations.line.trailing.dark.foregroundColor
                    }
                },
                light: {
                    after: {
                        backgroundColor: cfgTheme.annotations.line.trailing.light.backgroundColor || undefined,
                        color: cfgTheme.annotations.line.trailing.light.foregroundColor || themeDefaults.annotations.line.trailing.light.foregroundColor
                    }
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