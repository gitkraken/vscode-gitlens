import { DecorationInstanceRenderOptions, DecorationOptions, ThemableDecorationRenderOptions } from 'vscode';
import { IThemeConfig, themeDefaults } from '../configuration';
import { CommitFormatter, GitCommit, GitService, GitUri, ICommitFormatOptions } from '../gitService';
import * as moment from 'moment';

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

export class Annotations {

    static applyHeatmap(decoration: DecorationOptions, date: Date, now: moment.Moment) {
        const color = this._getHeatmapColor(now, date);
        (decoration.renderOptions!.before! as any).borderColor = color;
    }

    private static _getHeatmapColor(now: moment.Moment, date: Date) {
        const days = now.diff(moment(date), 'days');

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

    static async changesHover(commit: GitCommit, line: number, uri: GitUri, git: GitService): Promise<DecorationOptions> {
        let message: string | undefined = undefined;
        if (commit.isUncommitted) {
            const [previous, current] = await git.getDiffForLine(uri, line + uri.offset);
            message = CommitFormatter.toHoverDiff(commit, previous, current);
        }
        else if (commit.previousSha !== undefined) {
            const [previous, current] = await git.getDiffForLine(uri, line + uri.offset, commit.previousSha);
            message = CommitFormatter.toHoverDiff(commit, previous, current);
        }

        return {
            hoverMessage: message
        } as DecorationOptions;
    }

    static detailsHover(commit: GitCommit): DecorationOptions {
        const message = CommitFormatter.toHoverAnnotation(commit);
        return {
            hoverMessage: message
        } as DecorationOptions;
    }

    static gutter(commit: GitCommit, format: string, dateFormatOrFormatOptions: string | null | ICommitFormatOptions, renderOptions: IRenderOptions, compact: boolean): DecorationOptions {
        let content = `\u00a0${CommitFormatter.fromTemplate(format, commit, dateFormatOrFormatOptions)}\u00a0`;
        if (compact) {
            content = '\u00a0'.repeat(content.length);
        }

        return {
            renderOptions: {
                before: {
                    ...renderOptions.before,
                    ...{
                        contentText: content,
                        margin: '0 26px 0 0'
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

    static gutterRenderOptions(cfgTheme: IThemeConfig, heatmap: IHeatmapConfig): IRenderOptions {
        const cfgFileTheme = cfgTheme.annotations.file.gutter;

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
                height: cfgFileTheme.separateLines ? 'calc(100% - 1px)' : '100%'
            },
            dark: {
                backgroundColor: cfgFileTheme.dark.backgroundColor || undefined,
                color: cfgFileTheme.dark.foregroundColor || themeDefaults.annotations.file.gutter.dark.foregroundColor
            } as DecorationInstanceRenderOptions,
            light: {
                backgroundColor: cfgFileTheme.light.backgroundColor || undefined,
                color: cfgFileTheme.light.foregroundColor || themeDefaults.annotations.file.gutter.light.foregroundColor
            } as DecorationInstanceRenderOptions
        };
    }

    static hover(commit: GitCommit, renderOptions: IRenderOptions, heatmap: boolean): DecorationOptions {
        return {
            hoverMessage: CommitFormatter.toHoverAnnotation(commit),
            renderOptions: heatmap ? { before: { ...renderOptions.before } } : undefined
        } as DecorationOptions;
    }

    static hoverRenderOptions(cfgTheme: IThemeConfig, heatmap: IHeatmapConfig): IRenderOptions {
        if (!heatmap.enabled) return { before: undefined };

        return {
            before: {
                borderStyle: 'solid',
                borderWidth: '0 0 0 2px',
                contentText: '\u200B',
                height: cfgTheme.annotations.file.hover.separateLines ? 'calc(100% - 1px)' : '100%',
                margin: '0 26px 0 0'
            }
        } as IRenderOptions;
    }

    static trailing(commit: GitCommit, format: string, dateFormat: string | null, cfgTheme: IThemeConfig): DecorationOptions {
        const message = CommitFormatter.fromTemplate(format, commit, dateFormat);
        return {
            renderOptions: {
                after: {
                    contentText: `\u00a0${message}\u00a0`
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