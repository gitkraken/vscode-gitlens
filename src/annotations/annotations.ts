import { Dates, Objects, Strings } from '../system';
import { DecorationInstanceRenderOptions, DecorationOptions, MarkdownString, ThemableDecorationRenderOptions } from 'vscode';
import { DiffWithCommand, OpenCommitInRemoteCommand, ShowQuickCommitDetailsCommand } from '../commands';
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
        const color = this._getHeatmapColor(now, date);
        (decoration.renderOptions!.before! as any).borderColor = color;
    }

    private static _getHeatmapColor(now: number, date: Date) {
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

    static getHoverMessage(commit: GitCommit, dateFormat: string | null, hasRemotes: boolean): MarkdownString {
        if (dateFormat === null) {
            dateFormat = 'MMMM Do, YYYY h:MMa';
        }

        let message = '';
        if (!commit.isUncommitted) {
            message = commit.message
                // Escape markdown
                .replace(escapeMarkdownRegEx, '\\$&')
                // Escape markdown header (since the above regex won't match it)
                .replace(/^===/gm, `${GlyphChars.ZeroWidthSpace}===`)
                // Keep under the same block-quote
                .replace(/\n/g, '  \n');
            message = `\n\n> ${message}`;
        }

        const openInRemoteCommand = hasRemotes
            ? `${'&nbsp;'.repeat(3)} [\`${GlyphChars.ArrowUpRight}\`](${OpenCommitInRemoteCommand.getMarkdownCommandArgs(commit.sha)} "Open in Remote")`
            : '';

        const markdown = new MarkdownString(`[\`${commit.shortSha}\`](${ShowQuickCommitDetailsCommand.getMarkdownCommandArgs(commit.sha)} "Show Commit Details") &nbsp; __${commit.author}__, ${commit.fromNow()} &nbsp; _(${commit.formatDate(dateFormat)})_ ${openInRemoteCommand} &nbsp; ${message}`);
        markdown.isTrusted = true;
        return markdown;
    }

    static getHoverDiffMessage(commit: GitCommit, chunkLine: GitDiffChunkLine | undefined): MarkdownString | undefined {
        if (chunkLine === undefined) return undefined;

        const codeDiff = this._getCodeDiff(chunkLine);
        const markdown = new MarkdownString(commit.isUncommitted
            ? `[\`Changes\`](${DiffWithCommand.getMarkdownCommandArgs(commit)} "Open Changes") &nbsp; ${GlyphChars.Dash} &nbsp; _uncommitted_\n${codeDiff}`
            : `[\`Changes\`](${DiffWithCommand.getMarkdownCommandArgs(commit)} "Open Changes") &nbsp; ${GlyphChars.Dash} &nbsp; [\`${commit.previousShortSha}\`](${ShowQuickCommitDetailsCommand.getMarkdownCommandArgs(commit.previousSha!)} "Show Commit Details") ${GlyphChars.ArrowLeftRight} [\`${commit.shortSha}\`](${ShowQuickCommitDetailsCommand.getMarkdownCommandArgs(commit.sha)} "Show Commit Details")\n${codeDiff}`);
        markdown.isTrusted = true;
        return markdown;
    }

    private static _getCodeDiff(chunkLine: GitDiffChunkLine): string {
        const previous = chunkLine.previous === undefined ? undefined : chunkLine.previous[0];
        return `\`\`\`
-  ${previous === undefined || previous.line === undefined ? '' : previous.line.trim()}
+  ${chunkLine.line === undefined ? '' : chunkLine.line.trim()}
\`\`\``;
    }

    static async changesHover(commit: GitCommit, line: number, uri: GitUri, git: GitService): Promise<DecorationOptions> {
        const chunkLine = await git.getDiffForLine(uri, line + uri.offset, commit.isUncommitted ? undefined : commit.previousSha);
        const message = this.getHoverDiffMessage(commit, chunkLine);

        return {
            hoverMessage: message
        } as DecorationOptions;
    }

    static detailsHover(commit: GitCommit, dateFormat: string | null, hasRemotes: boolean): DecorationOptions {
        const message = this.getHoverMessage(commit, dateFormat, hasRemotes);
        return {
            hoverMessage: message
        } as DecorationOptions;
    }

    static gutter(commit: GitCommit, format: string, dateFormatOrFormatOptions: string | null | ICommitFormatOptions, renderOptions: IRenderOptions): DecorationOptions {
        const content = Strings.pad(CommitFormatter.fromTemplate(format, commit, dateFormatOrFormatOptions), 1, 1);

        return {
            renderOptions: {
                before: {
                    ...renderOptions.before,
                    ...{
                        contentText: content
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
        for (const token of Objects.values<Strings.ITokenOptions | undefined>(options.tokenOptions)) {
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
                    contentText: Strings.pad(message, 1, 1)
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