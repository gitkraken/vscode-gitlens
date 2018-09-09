import {
    DecorationInstanceRenderOptions,
    DecorationOptions,
    MarkdownString,
    ThemableDecorationRenderOptions,
    ThemeColor,
    workspace
} from 'vscode';
import {
    DiffWithCommand,
    OpenCommitInRemoteCommand,
    OpenFileRevisionCommand,
    ShowQuickCommitDetailsCommand,
    ShowQuickCommitFileDetailsCommand
} from '../commands';
import { FileAnnotationType } from '../configuration';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import {
    CommitFormatter,
    GitCommit,
    GitDiffChunkLine,
    GitRemote,
    GitService,
    GitUri,
    ICommitFormatOptions
} from '../git/gitService';
import { Objects, Strings } from '../system';
import { toRgba } from '../ui/shared/colors';

export interface ComputedHeatmap {
    cold: boolean;
    colors: { hot: string; cold: string };
    median: number;
    newest: number;
    oldest: number;
    computeAge(date: Date): number;
}

interface IHeatmapConfig {
    enabled: boolean;
    location?: 'left' | 'right';
}

interface IRenderOptions extends DecorationInstanceRenderOptions, ThemableDecorationRenderOptions {
    height?: string;
    uncommittedColor?: string | ThemeColor;
}

const defaultHeatmapHotColor = '#f66a0a';
const defaultHeatmapColdColor = '#0a60f6';
const escapeMarkdownRegEx = /[`\>\#\*\_\-\+\.]/g;
// const sampleMarkdown = '## message `not code` *not important* _no underline_ \n> don\'t quote me \n- don\'t list me \n+ don\'t list me \n1. don\'t list me \nnot h1 \n=== \nnot h2 \n---\n***\n---\n___';
const markdownHeaderReplacement = `${GlyphChars.ZeroWidthSpace}===`;

let computedHeatmapColor: {
    color: string;
    rgb: string;
};

export class Annotations {
    static applyHeatmap(decoration: DecorationOptions, date: Date, heatmap: ComputedHeatmap) {
        const color = this.getHeatmapColor(date, heatmap);
        (decoration.renderOptions!.before! as any).borderColor = color;
    }

    private static getHeatmapColor(date: Date, heatmap: ComputedHeatmap) {
        const baseColor = heatmap.cold ? heatmap.colors.cold : heatmap.colors.hot;

        const age = heatmap.computeAge(date);
        if (age === 0) return baseColor;

        if (computedHeatmapColor === undefined || computedHeatmapColor.color !== baseColor) {
            let rgba = toRgba(baseColor);
            if (rgba == null) {
                rgba = toRgba(heatmap.cold ? defaultHeatmapColdColor : defaultHeatmapHotColor)!;
            }

            const [r, g, b] = rgba;
            computedHeatmapColor = {
                color: baseColor,
                rgb: `${r}, ${g}, ${b}`
            };
        }

        return `rgba(${computedHeatmapColor.rgb}, ${(1 - age / 10).toFixed(2)})`;
    }

    private static getHoverCommandBar(
        commit: GitCommit,
        hasRemote: boolean,
        annotationType?: FileAnnotationType,
        line: number = 0
    ) {
        let commandBar = `[\`${GlyphChars.MuchGreaterThan}\`](${DiffWithCommand.getMarkdownCommandArgs(
            commit
        )} "Open Changes") `;

        if (commit.previousSha !== undefined) {
            if (annotationType === FileAnnotationType.RecentChanges) {
                annotationType = FileAnnotationType.Blame;
            }

            const uri = GitUri.toRevisionUri(commit.previousSha, commit.previousUri.fsPath, commit.repoPath);
            commandBar += `[\`${GlyphChars.SquareWithTopShadow}\`](${OpenFileRevisionCommand.getMarkdownCommandArgs(
                uri,
                annotationType || FileAnnotationType.Blame,
                line
            )} "Blame Previous Revision") `;
        }

        if (hasRemote) {
            commandBar += `[\`${GlyphChars.ArrowUpRight}\`](${OpenCommitInRemoteCommand.getMarkdownCommandArgs(
                commit.sha
            )} "Open in Remote") `;
        }

        commandBar += `[\`${GlyphChars.MiddleEllipsis}\`](${ShowQuickCommitFileDetailsCommand.getMarkdownCommandArgs(
            commit.sha
        )} "Show More Actions")`;

        return commandBar;
    }

    static getHoverMessage(
        commit: GitCommit,
        dateFormat: string | null,
        remotes: GitRemote[],
        annotationType?: FileAnnotationType,
        line: number = 0
    ): MarkdownString {
        if (dateFormat === null) {
            dateFormat = 'MMMM Do, YYYY h:mma';
        }

        let message = '';
        let commandBar = '';
        let showCommitDetailsCommand = '';
        let avatar = '';
        if (!commit.isUncommitted) {
            commandBar = `\n\n${this.getHoverCommandBar(commit, remotes.length !== 0, annotationType, line)}`;
            showCommitDetailsCommand = `[\`${commit.shortSha}\`](${ShowQuickCommitDetailsCommand.getMarkdownCommandArgs(
                commit.sha
            )} "Show Commit Details")`;

            message = CommitFormatter.fromTemplate('${message}', commit);
            for (const r of remotes) {
                if (r.provider === undefined) continue;

                message = r.provider.enrichMessage(message);
                break;
            }

            message
                // Escape markdown
                .replace(escapeMarkdownRegEx, '\\$&')
                // Escape markdown header (since the above regex won't match it)
                .replace(/^===/gm, markdownHeaderReplacement)
                // Keep under the same block-quote
                .replace(/\n/g, '  \n');
            message = `\n\n> ${message}`;
        }
        else {
            showCommitDetailsCommand = `\`${commit.shortSha === 'working' ? '00000000' : commit.shortSha}\``;
        }

        if (Container.config.hovers.avatars) {
            avatar = ` &nbsp; ![](${commit.getGravatarUri(Container.config.defaultGravatarsStyle).toString(true)})`;
        }

        const markdown = new MarkdownString(
            `${showCommitDetailsCommand}${avatar} &nbsp;__${
                commit.author
            }__, ${commit.fromNow()} &nbsp; _(${commit.formatDate(dateFormat)})_ ${message}${commandBar}`
        );
        markdown.isTrusted = true;
        return markdown;
    }

    static getHoverDiffMessage(
        commit: GitCommit,
        uri: GitUri,
        chunkLine: GitDiffChunkLine | undefined
    ): MarkdownString | undefined {
        if (chunkLine === undefined || commit.previousSha === undefined) return undefined;

        const codeDiff = this.getCodeDiff(chunkLine);

        let message: string;
        if (commit.isUncommitted) {
            if (uri.sha !== undefined && GitService.isStagedUncommitted(uri.sha)) {
                message = `[\`Changes\`](${DiffWithCommand.getMarkdownCommandArgs(commit)} "Open Changes") &nbsp; ${
                    GlyphChars.Dash
                } &nbsp; [\`${commit.previousShortSha}\`](${ShowQuickCommitDetailsCommand.getMarkdownCommandArgs(
                    commit.previousSha!
                )} "Show Commit Details") ${GlyphChars.ArrowLeftRightLong} _${uri.shortSha}_\n${codeDiff}`;
            }
            else {
                message = `[\`Changes\`](${DiffWithCommand.getMarkdownCommandArgs(commit)} "Open Changes") &nbsp; ${
                    GlyphChars.Dash
                } &nbsp; _uncommitted changes_\n${codeDiff}`;
            }
        }
        else {
            message = `[\`Changes\`](${DiffWithCommand.getMarkdownCommandArgs(commit)} "Open Changes") &nbsp; ${
                GlyphChars.Dash
            } &nbsp; [\`${commit.previousShortSha}\`](${ShowQuickCommitDetailsCommand.getMarkdownCommandArgs(
                commit.previousSha!
            )} "Show Commit Details") ${GlyphChars.ArrowLeftRightLong} [\`${
                commit.shortSha
            }\`](${ShowQuickCommitDetailsCommand.getMarkdownCommandArgs(
                commit.sha
            )} "Show Commit Details")\n${codeDiff}`;
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

    static async changesHover(commit: GitCommit, line: number, uri: GitUri): Promise<DecorationOptions> {
        const sha =
            !commit.isUncommitted || (uri.sha !== undefined && GitService.isStagedUncommitted(uri.sha))
                ? commit.previousSha
                : undefined;
        const chunkLine = await Container.git.getDiffForLine(uri, line, sha);
        const message = this.getHoverDiffMessage(commit, uri, chunkLine);

        return {
            hoverMessage: message
        } as DecorationOptions;
    }

    // static detailsHover(commit: GitCommit, dateFormat: string | null, hasRemote: boolean, annotationType?: FileAnnotationType, line: number = 0): DecorationOptions {
    //     const message = this.getHoverMessage(commit, dateFormat, hasRemote, annotationType);
    //     return {
    //         hoverMessage: message
    //     } as DecorationOptions;
    // }

    static gutter(
        commit: GitCommit,
        format: string,
        dateFormatOrFormatOptions: string | null | ICommitFormatOptions,
        renderOptions: IRenderOptions
    ): DecorationOptions {
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

    static gutterRenderOptions(
        separateLines: boolean,
        heatmap: IHeatmapConfig,
        format: string,
        options: ICommitFormatOptions
    ): IRenderOptions {
        // Get the character count of all the tokens, assuming there there is a cap (bail if not)
        let chars = 0;
        for (const token of Objects.values(options.tokenOptions!)) {
            if (token === undefined) continue;

            // If any token is uncapped, kick out and set no max
            if (token.truncateTo == null) {
                chars = -1;
                break;
            }

            chars += token.truncateTo;
        }

        if (chars >= 0) {
            // Add the chars of the template string (without tokens)
            chars += Strings.getWidth(Strings.interpolate(format, undefined));
            // If we have chars, add a bit of padding
            if (chars > 0) {
                chars += 3;
            }
        }

        let borderStyle = undefined;
        let borderWidth = undefined;
        if (heatmap.enabled) {
            borderStyle = 'solid';
            borderWidth = heatmap.location === 'left' ? '0 0 0 2px' : '0 2px 0 0';
        }

        let width;
        if (chars >= 0) {
            const spacing = workspace.getConfiguration('editor').get<number>('letterSpacing');
            if (spacing != null && spacing !== 0) {
                width = `calc(${chars}ch + ${Math.round(chars * spacing)}px)`;
            }
            else {
                width = `${chars}ch`;
            }
        }

        return {
            backgroundColor: new ThemeColor('gitlens.gutterBackgroundColor'),
            borderStyle: borderStyle,
            borderWidth: borderWidth,
            color: new ThemeColor('gitlens.gutterForegroundColor'),
            fontWeight: 'normal',
            fontStyle: 'normal',
            height: '100%',
            margin: `0 26px -1px 0`,
            textDecoration: separateLines ? 'overline solid rgba(0, 0, 0, .2)' : 'none',
            width: width,
            uncommittedColor: new ThemeColor('gitlens.gutterUncommittedForegroundColor')
        } as IRenderOptions;
    }

    static heatmap(commit: GitCommit, heatmap: ComputedHeatmap, renderOptions: IRenderOptions): DecorationOptions {
        const decoration = {
            renderOptions: {
                before: { ...renderOptions }
            } as DecorationInstanceRenderOptions
        } as DecorationOptions;

        Annotations.applyHeatmap(decoration, commit.date, heatmap);

        return decoration;
    }

    static heatmapRenderOptions(): IRenderOptions {
        return {
            borderStyle: 'solid',
            borderWidth: '0 0 0 2px',
            contentText: GlyphChars.ZeroWidthSpace,
            height: '100%',
            margin: '0 26px -1px 0'
        } as IRenderOptions;
    }

    // static hover(commit: GitCommit, renderOptions: IRenderOptions, now: number): DecorationOptions {
    //     const decoration = {
    //         renderOptions: { before: { ...renderOptions } }
    //     } as DecorationOptions;

    //     this.applyHeatmap(decoration, commit.date, now);

    //     return decoration;
    // }

    // static hoverRenderOptions(heatmap: IHeatmapConfig): IRenderOptions {
    //     if (!heatmap.enabled) return { before: undefined };

    //     return {
    //         borderStyle: 'solid',
    //         borderWidth: '0 0 0 2px',
    //         contentText: GlyphChars.ZeroWidthSpace,
    //         height: '100%',
    //         margin: '0 26px 0 0',
    //         textDecoration: 'none'
    //     } as IRenderOptions;
    // }

    static trailing(
        commit: GitCommit,
        format: string,
        dateFormat: string | null,
        scrollable: boolean = true
    ): DecorationOptions {
        const message = CommitFormatter.fromTemplate(format, commit, {
            truncateMessageAtNewLine: true,
            dateFormat: dateFormat
        } as ICommitFormatOptions);

        return {
            renderOptions: {
                after: {
                    backgroundColor: new ThemeColor('gitlens.trailingLineBackgroundColor'),
                    color: new ThemeColor('gitlens.trailingLineForegroundColor'),
                    contentText: Strings.pad(message.replace(/ /g, GlyphChars.Space), 1, 1),
                    fontWeight: 'normal',
                    fontStyle: 'normal',
                    // Pull the decoration out of the document flow if we want to be scrollable
                    textDecoration: `none;${scrollable ? '' : ' position: absolute;'}`
                }
            } as DecorationInstanceRenderOptions
        } as DecorationOptions;
    }

    // static withRange(decoration: DecorationOptions, start?: number, end?: number): DecorationOptions {
    //     let range = decoration.range;
    //     if (start !== undefined) {
    //         range = range.with({
    //             start: range.start.with({ character: start })
    //         });
    //     }

    //     if (end !== undefined) {
    //         range = range.with({
    //             end: range.end.with({ character: end })
    //         });
    //     }

    //     return { ...decoration, range: range };
    // }
}
