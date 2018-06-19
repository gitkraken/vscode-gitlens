'use strict';
import { Objects, Strings } from '../system';
import { DecorationOptions, DecorationRenderOptions, Range, TextEditorDecorationType, window } from 'vscode';
import { Annotations } from './annotations';
import { BlameAnnotationProviderBase } from './blameAnnotationProvider';
import { FileAnnotationType, GravatarDefaultStyle } from '../configuration';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { GitBlameCommit, ICommitFormatOptions } from '../gitService';
import { Logger } from '../logger';

export class GutterBlameAnnotationProvider extends BlameAnnotationProviderBase {

    async onProvideAnnotation(shaOrLine?: string | number, type?: FileAnnotationType): Promise<boolean> {
        this.annotationType = FileAnnotationType.Blame;

        const blame = await this.getBlame();
        if (blame === undefined) return false;

        const start = process.hrtime();

        const cfg = Container.config.blame;

        // Precalculate the formatting options so we don't need to do it on each iteration
        const tokenOptions = Strings.getTokensFromTemplate(cfg.format)
            .reduce((map, token) => {
                map[token.key] = token.options as ICommitFormatOptions;
                return map;
            }, {} as { [token: string]: ICommitFormatOptions });

        const options: ICommitFormatOptions = {
            dateFormat: cfg.dateFormat === null ? Container.config.defaultDateFormat : cfg.dateFormat,
            tokenOptions: tokenOptions
        };

        const avatars = cfg.avatars;
        const gravatarDefault = Container.config.defaultGravatarsStyle;
        const separateLines = cfg.separateLines;
        const renderOptions = Annotations.gutterRenderOptions(separateLines, cfg.heatmap, cfg.format, options);

        this.decorations = [];
        const decorationsMap: { [sha: string]: DecorationOptions | undefined } = Object.create(null);
        const avatarDecorationsMap: { [email: string]: { decoration: TextEditorDecorationType, ranges: Range[] } } | undefined = avatars ? Object.create(null) : undefined;

        let commit: GitBlameCommit | undefined;
        let compacted = false;
        let gutter: DecorationOptions | undefined;
        let previousSha: string | undefined;

        let computedHeatmap;
        if (cfg.heatmap.enabled) {
            computedHeatmap = this.getComputedHeatmap(blame);
        }

        for (const l of blame.lines) {
            const line = l.line;

            if (previousSha === l.sha) {
                // Use a shallow copy of the previous decoration options
                gutter = { ...gutter } as DecorationOptions;

                if (cfg.compact && !compacted) {
                    // Since we are wiping out the contextText make sure to copy the objects
                    gutter.renderOptions = {
                        before: {
                            ...gutter.renderOptions!.before,
                            contentText: GlyphChars.Space.repeat(Strings.width(gutter.renderOptions!.before!.contentText!))
                        }
                    };

                    if (separateLines) {
                        gutter.renderOptions!.before!.textDecoration = 'none';
                    }

                    compacted = true;
                }

                gutter.range = new Range(line, 0, line, 0);

                this.decorations.push(gutter);

                if (avatars && !cfg.compact && commit !== undefined && commit.email !== undefined) {
                    this.addOrUpdateGravatarDecoration(commit, gutter.range, gravatarDefault, avatarDecorationsMap!);
                }

                continue;
            }

            compacted = false;
            previousSha = l.sha;

            commit = blame.commits.get(l.sha);
            if (commit === undefined) continue;

            gutter = decorationsMap[l.sha];
            if (gutter !== undefined) {
                gutter = {
                    ...gutter,
                    range: new Range(line, 0, line, 0)
                } as DecorationOptions;

                this.decorations.push(gutter);

                if (avatars && commit.email !== undefined) {
                    this.addOrUpdateGravatarDecoration(commit, gutter.range, gravatarDefault, avatarDecorationsMap!);
                }

                continue;
            }

            gutter = Annotations.gutter(commit, cfg.format, options, renderOptions);

            if (computedHeatmap !== undefined) {
                Annotations.applyHeatmap(gutter, commit.date, computedHeatmap);
            }

            gutter.range = new Range(line, 0, line, 0);

            this.decorations.push(gutter);

            if (avatars && commit.email !== undefined) {
                this.addOrUpdateGravatarDecoration(commit, gutter.range, gravatarDefault, avatarDecorationsMap!);
            }

            decorationsMap[l.sha] = gutter;
        }

        if (this.decorations.length) {
            this.editor.setDecorations(this.decoration!, this.decorations);

            if (avatars) {
                this.additionalDecorations = [];
                for (const d of Objects.values(avatarDecorationsMap!)) {
                    this.additionalDecorations.push(d);
                    this.editor.setDecorations(d.decoration, d.ranges);
                }
            }
        }

        const duration = process.hrtime(start);
        Logger.log(`${(duration[0] * 1000) + Math.floor(duration[1] / 1000000)} ms to compute gutter blame annotations`);

        this.registerHoverProviders(Container.config.hovers.annotations);
        this.selection(shaOrLine, blame);
        return true;
    }

    addOrUpdateGravatarDecoration(commit: GitBlameCommit, range: Range, gravatarDefault: GravatarDefaultStyle, map: { [email: string]: { decoration: TextEditorDecorationType, ranges: Range[] } }) {
        const avatarDecoration = map[commit.email!];
        if (avatarDecoration !== undefined) {
            avatarDecoration.ranges.push(range);

            return;
        }

        map[commit.email!] = {
            decoration: window.createTextEditorDecorationType({
                gutterIconPath: commit.getGravatarUri(gravatarDefault),
                gutterIconSize: '16px 16px'
            } as DecorationRenderOptions),
            ranges: [range]
        };
    }
}