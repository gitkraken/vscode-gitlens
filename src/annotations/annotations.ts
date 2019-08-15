import {
    DecorationInstanceRenderOptions,
    DecorationOptions,
    MarkdownString,
    ThemableDecorationAttachmentRenderOptions,
    ThemableDecorationRenderOptions,
    ThemeColor
} from 'vscode';
import { DiffWithCommand, ShowQuickCommitDetailsCommand } from '../commands';
import { configuration, FileAnnotationType } from '../configuration';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import {
    CommitFormatOptions,
    CommitFormatter,
    GitBlameCommit,
    GitCommit,
    GitDiffHunkLine,
    GitLogCommit,
    GitService,
    GitUri
} from '../git/gitService';
import { Objects, Strings } from '../system';
import { toRgba } from '../webviews/apps/shared/colors';

export interface ComputedHeatmap {
    cold: boolean;
    colors: { hot: string; cold: string };
    median: number;
    newest: number;
    oldest: number;
    computeAge(date: Date): number;
}

interface HeatmapConfig {
    enabled: boolean;
    location?: 'left' | 'right';
}

interface RenderOptions
    extends DecorationInstanceRenderOptions,
        ThemableDecorationRenderOptions,
        ThemableDecorationAttachmentRenderOptions {
    height?: string;
    uncommittedColor?: string | ThemeColor;
}

const defaultHeatmapHotColor = '#f66a0a';
const defaultHeatmapColdColor = '#0a60f6';

let computedHeatmapColor: {
    color: string;
    rgb: string;
};

export class Annotations {
    static applyHeatmap(decoration: Partial<DecorationOptions>, date: Date, heatmap: ComputedHeatmap) {
        const color = this.getHeatmapColor(date, heatmap);
        decoration.renderOptions!.before!.borderColor = color;
    }

    static async changesHoverMessage(
        commit: GitBlameCommit,
        uri: GitUri,
        editorLine: number
    ): Promise<MarkdownString | undefined>;
    static async changesHoverMessage(
        commit: GitLogCommit,
        uri: GitUri,
        editorLine: number,
        hunkLine: GitDiffHunkLine
    ): Promise<MarkdownString | undefined>;
    static async changesHoverMessage(
        commit: GitBlameCommit | GitLogCommit,
        uri: GitUri,
        editorLine: number,
        hunkLine?: GitDiffHunkLine
    ): Promise<MarkdownString | undefined> {
        const documentRef = uri.sha;
        if (GitBlameCommit.is(commit)) {
            // TODO: Figure out how to optimize this
            let ref;
            if (commit.isUncommitted) {
                if (GitService.isUncommittedStaged(documentRef)) {
                    ref = documentRef;
                }
            }
            else {
                ref = commit.sha;
            }

            const line = editorLine + 1;
            const commitLine = commit.lines.find(l => l.line === line) || commit.lines[0];

            let originalFileName = commit.originalFileName;
            if (originalFileName === undefined) {
                if (uri.fsPath !== commit.uri.fsPath) {
                    originalFileName = commit.fileName;
                }
            }

            editorLine = commitLine.originalLine - 1;
            hunkLine = await Container.git.getDiffForLine(uri, editorLine, ref, undefined, originalFileName);

            // If we didn't find a diff & ref is undefined (meaning uncommitted), check for a staged diff
            if (hunkLine === undefined && ref === undefined) {
                hunkLine = await Container.git.getDiffForLine(
                    uri,
                    editorLine,
                    undefined,
                    GitService.uncommittedStagedSha,
                    originalFileName
                );
            }
        }

        if (hunkLine === undefined || commit.previousSha === undefined) return undefined;

        const diff = this.getDiffFromHunkLine(hunkLine);

        let message;
        let previous;
        let current;
        if (commit.isUncommitted) {
            const diffUris = await commit.getPreviousLineDiffUris(uri, editorLine, documentRef);
            if (diffUris === undefined || diffUris.previous === undefined) {
                return undefined;
            }

            message = `[\`Changes\`](${DiffWithCommand.getMarkdownCommandArgs({
                lhs: {
                    sha: diffUris.previous.sha || '',
                    uri: diffUris.previous.documentUri()
                },
                rhs: {
                    sha: diffUris.current.sha || '',
                    uri: diffUris.current.documentUri()
                },
                repoPath: commit.repoPath,
                line: editorLine
            })} "Open Changes")`;

            previous =
                diffUris.previous.sha === undefined || diffUris.previous.isUncommitted
                    ? `_${GitService.shortenSha(diffUris.previous.sha, {
                          strings: {
                              working: 'Working Tree'
                          }
                      })}_`
                    : `[\`${GitService.shortenSha(
                          diffUris.previous.sha || ''
                      )}\`](${ShowQuickCommitDetailsCommand.getMarkdownCommandArgs(
                          diffUris.previous.sha || ''
                      )} "Show Commit Details")`;

            current =
                diffUris.current.sha === undefined || diffUris.current.isUncommitted
                    ? `_${GitService.shortenSha(diffUris.current.sha, {
                          strings: {
                              working: 'Working Tree'
                          }
                      })}_`
                    : `[\`${GitService.shortenSha(
                          diffUris.current.sha || ''
                      )}\`](${ShowQuickCommitDetailsCommand.getMarkdownCommandArgs(
                          diffUris.current.sha || ''
                      )} "Show Commit Details")`;
        }
        else {
            message = `[\`Changes\`](${DiffWithCommand.getMarkdownCommandArgs(commit, editorLine)} "Open Changes")`;

            previous = `[\`${commit.previousShortSha}\`](${ShowQuickCommitDetailsCommand.getMarkdownCommandArgs(
                commit.previousSha
            )} "Show Commit Details")`;

            current = `[\`${commit.shortSha}\`](${ShowQuickCommitDetailsCommand.getMarkdownCommandArgs(
                commit.sha
            )} "Show Commit Details")`;
        }

        message += ` &nbsp; ${GlyphChars.Dash} &nbsp; ${previous} &nbsp;${GlyphChars.ArrowLeftRightLong}&nbsp; ${current}\n${diff}`;

        const markdown = new MarkdownString(message);
        markdown.isTrusted = true;
        return markdown;
    }

    static async detailsHoverMessage(
        commit: GitCommit,
        uri: GitUri,
        editorLine: number,
        dateFormat: string | null,
        annotationType: FileAnnotationType | undefined
    ): Promise<MarkdownString> {
        if (dateFormat === null) {
            dateFormat = 'MMMM Do, YYYY h:mma';
        }

        const [presence, previousLineDiffUris, remotes] = await Promise.all([
            Container.vsls.getContactPresence(commit.email),
            commit.isUncommitted ? commit.getPreviousLineDiffUris(uri, editorLine, uri.sha) : undefined,
            Container.git.getRemotes(commit.repoPath, { sort: true })
        ]);

        const markdown = new MarkdownString(
            CommitFormatter.fromTemplate(Container.config.hovers.detailsMarkdownFormat, commit, {
                annotationType: annotationType,
                dateFormat: dateFormat,
                line: editorLine,
                markdown: true,
                presence: presence,
                previousLineDiffUris: previousLineDiffUris,
                remotes: remotes
            })
        );
        markdown.isTrusted = true;
        return markdown;
    }

    static gutter(
        commit: GitCommit,
        format: string,
        dateFormatOrFormatOptions: string | null | CommitFormatOptions,
        renderOptions: RenderOptions
    ): Partial<DecorationOptions> {
        const decoration: Partial<DecorationOptions> = {
            renderOptions: {
                before: { ...renderOptions }
            }
        };

        if (commit.isUncommitted) {
            decoration.renderOptions!.before!.color = renderOptions.uncommittedColor;
        }

        const message = CommitFormatter.fromTemplate(format, commit, dateFormatOrFormatOptions);
        decoration.renderOptions!.before!.contentText = Strings.pad(message.replace(/ /g, GlyphChars.Space), 1, 1);

        return decoration;
    }

    static gutterRenderOptions(
        separateLines: boolean,
        heatmap: HeatmapConfig,
        format: string,
        options: CommitFormatOptions
    ): RenderOptions {
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
            const spacing = configuration.getAny<number>('editor.letterSpacing');
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
            margin: '0 26px -1px 0',
            textDecoration: separateLines ? 'overline solid rgba(0, 0, 0, .2)' : 'none',
            width: width,
            uncommittedColor: new ThemeColor('gitlens.gutterUncommittedForegroundColor')
        };
    }

    static heatmap(
        commit: GitCommit,
        heatmap: ComputedHeatmap,
        renderOptions: RenderOptions
    ): Partial<DecorationOptions> {
        const decoration: Partial<DecorationOptions> = {
            renderOptions: {
                before: { ...renderOptions }
            }
        };

        Annotations.applyHeatmap(decoration, commit.date, heatmap);

        return decoration;
    }

    static heatmapRenderOptions(): RenderOptions {
        return {
            borderStyle: 'solid',
            borderWidth: '0 0 0 2px'
        };
    }

    static trailing(
        commit: GitCommit,
        // uri: GitUri,
        // editorLine: number,
        format: string,
        dateFormat: string | null,
        scrollable: boolean = true,
        getBranchAndTagTips?: (sha: string) => string | undefined
    ): Partial<DecorationOptions> {
        // TODO: Enable this once there is better caching
        // let diffUris;
        // if (commit.isUncommitted) {
        //     diffUris = await commit.getPreviousLineDiffUris(uri, editorLine, uri.sha);
        // }

        const message = CommitFormatter.fromTemplate(format, commit, {
            dateFormat: dateFormat,
            getBranchAndTagTips: getBranchAndTagTips,
            // previousLineDiffUris: diffUris,
            truncateMessageAtNewLine: true
        });

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
            }
        };
    }

    private static getDiffFromHunkLine(hunkLine: GitDiffHunkLine): string {
        if (Container.config.hovers.changesDiff === 'hunk') {
            return `\`\`\`diff\n${hunkLine.hunk.diff}\n\`\`\``;
        }

        return `\`\`\`diff${hunkLine.previous === undefined ? '' : `\n-${hunkLine.previous.line}`}${
            hunkLine.current === undefined ? '' : `\n+${hunkLine.current.line}`
        }\n\`\`\``;
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
}
