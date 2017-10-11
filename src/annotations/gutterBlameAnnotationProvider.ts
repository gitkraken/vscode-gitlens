'use strict';
import { Strings } from '../system';
import { DecorationOptions, Range } from 'vscode';
import { FileAnnotationType } from './annotationController';
import { Annotations } from './annotations';
import { BlameAnnotationProviderBase } from './blameAnnotationProvider';
import { GlyphChars } from '../constants';
import { GitBlameCommit, ICommitFormatOptions } from '../gitService';
import { Logger } from '../logger';

export class GutterBlameAnnotationProvider extends BlameAnnotationProviderBase {

    async provideAnnotation(shaOrLine?: string | number, type?: FileAnnotationType): Promise<boolean> {
        this.annotationType = FileAnnotationType.Gutter;

        const blame = await this.getBlame();
        if (blame === undefined) return false;

        const start = process.hrtime();

        const cfg = this._config.annotations.file.gutter;

        // Precalculate the formatting options so we don't need to do it on each iteration
        const tokenOptions = Strings.getTokensFromTemplate(cfg.format)
            .reduce((map, token) => {
                map[token.key] = token.options as ICommitFormatOptions;
                return map;
            }, {} as { [token: string]: ICommitFormatOptions });

        const options: ICommitFormatOptions = {
            dateFormat: cfg.dateFormat === null ? this._config.defaultDateFormat : cfg.dateFormat,
            tokenOptions: tokenOptions
        };

        const now = Date.now();
        const renderOptions = Annotations.gutterRenderOptions(this._config.theme, cfg.heatmap, options);
        const separateLines = this._config.theme.annotations.file.gutter.separateLines;

        this._decorations = [];
        const decorationsMap: { [sha: string]: DecorationOptions | undefined } = Object.create(null);

        let commit: GitBlameCommit | undefined;
        let compacted = false;
        let gutter: DecorationOptions | undefined;
        let previousSha: string | undefined;

        for (const l of blame.lines) {
            const line = l.line;

            if (previousSha === l.sha) {
                // Use a shallow copy of the previous decoration options
                gutter = { ...gutter } as DecorationOptions;

                if (cfg.compact && !compacted) {
                    // Since we are wiping out the contextText make sure to copy the objects
                    gutter.renderOptions = {
                        ...gutter.renderOptions,
                        before: {
                            ...gutter.renderOptions!.before,
                            contentText: GlyphChars.Space.repeat(Strings.width(gutter.renderOptions!.before!.contentText!))
                        }
                    };

                    if (separateLines) {
                        gutter.renderOptions.dark = {
                            ...gutter.renderOptions.dark,
                            before: { ...gutter.renderOptions.dark!.before, textDecoration: 'none' }
                        };
                        gutter.renderOptions.light = {
                            ...gutter.renderOptions.light,
                            before: { ...gutter.renderOptions.light!.before, textDecoration: 'none' }
                        };
                    }

                    compacted = true;
                }

                gutter.range = new Range(line, 0, line, 0);

                this._decorations.push(gutter);

                continue;
            }

            compacted = false;
            previousSha = l.sha;

            gutter = decorationsMap[l.sha];
            if (gutter !== undefined) {
                gutter = {
                    ...gutter,
                    range: new Range(line, 0, line, 0)
                } as DecorationOptions;

                this._decorations.push(gutter);

                continue;
            }

            commit = blame.commits.get(l.sha);
            if (commit === undefined) continue;

            gutter = Annotations.gutter(commit, cfg.format, options, renderOptions);

            if (cfg.heatmap.enabled) {
                Annotations.applyHeatmap(gutter, commit.date, now);
            }

            gutter.range = new Range(line, 0, line, 0);

            this._decorations.push(gutter);
            decorationsMap[l.sha] = gutter;
        }

        if (this._decorations.length) {
            this.editor.setDecorations(this.decoration!, this._decorations);
        }

        const duration = process.hrtime(start);
        Logger.log(`${(duration[0] * 1000) + Math.floor(duration[1] / 1000000)} ms to compute gutter blame annotations`);

        this.registerHoverProviders(cfg.hover);
        this.selection(shaOrLine, blame);
        return true;
    }
}