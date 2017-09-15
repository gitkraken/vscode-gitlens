'use strict';
import { Strings } from '../system';
import { DecorationOptions, Range } from 'vscode';
import { FileAnnotationType } from './annotationController';
import { Annotations, endOfLineIndex } from './annotations';
import { BlameAnnotationProviderBase } from './blameAnnotationProvider';
import { GlyphChars } from '../constants';
import { GitBlameCommit, ICommitFormatOptions } from '../gitService';
import { Logger } from '../logger';

export class GutterBlameAnnotationProvider extends BlameAnnotationProviderBase {

    async provideAnnotation(shaOrLine?: string | number, type?: FileAnnotationType): Promise<boolean> {
        this.annotationType = FileAnnotationType.Gutter;

        const blame = await this.getBlame(true);
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
        const offset = this.uri.offset;
        const renderOptions = Annotations.gutterRenderOptions(this._config.theme, cfg.heatmap);
        const dateFormat = this._config.defaultDateFormat;
        const separateLines = this._config.theme.annotations.file.gutter.separateLines;

        const decorations: DecorationOptions[] = [];
        const document = this.document;

        let commit: GitBlameCommit | undefined;
        let compacted = false;
        let details: DecorationOptions | undefined;
        let gutter: DecorationOptions | undefined;
        let previousSha: string | undefined;

        for (const l of blame.lines) {
            commit = blame.commits.get(l.sha);
            if (commit === undefined) continue;

            const line = l.line + offset;

            if (previousSha === l.sha) {
                // Use a shallow copy of the previous decoration options
                gutter = { ...gutter } as DecorationOptions;
                if (cfg.compact && !compacted) {
                    // Since we are wiping out the contextText make sure to copy the objects
                    gutter.renderOptions = { ...gutter.renderOptions };
                    gutter.renderOptions.before = {
                        ...gutter.renderOptions.before,
                        ...{ contentText: GlyphChars.Space.repeat(Strings.getWidth(gutter.renderOptions!.before!.contentText!)) }
                    };

                    if (separateLines) {
                        gutter.renderOptions.dark = { ...gutter.renderOptions.dark };
                        gutter.renderOptions.dark.before = { ...gutter.renderOptions.dark.before, ...{ textDecoration: 'none' } };
                        gutter.renderOptions.light = { ...gutter.renderOptions.light };
                        gutter.renderOptions.light.before = { ...gutter.renderOptions.light.before, ...{ textDecoration: 'none' } };
                    }

                    compacted = true;
                }

                const endIndex = document.lineAt(line).firstNonWhitespaceCharacterIndex;
                gutter.range = new Range(line, 0, line, endIndex);
                decorations.push(gutter);

                if (details !== undefined) {
                    details = { ...details } as DecorationOptions;
                    details.range = cfg.hover.wholeLine
                        ? document.validateRange(new Range(line, 0, line, endOfLineIndex))
                        : gutter.range;
                    decorations.push(details);
                }

                continue;
            }

            compacted = false;
            previousSha = l.sha;

            gutter = Annotations.gutter(commit, cfg.format, options, renderOptions);

            if (cfg.heatmap.enabled) {
                Annotations.applyHeatmap(gutter, commit.date, now);
            }

            const endIndex = document.lineAt(line).firstNonWhitespaceCharacterIndex;
            gutter.range = new Range(line, 0, line, endIndex);
            decorations.push(gutter);

            if (cfg.hover.details) {
                details = Annotations.detailsHover(commit, dateFormat);
                details.range = cfg.hover.wholeLine
                    ? document.validateRange(new Range(line, 0, line, endOfLineIndex))
                    : gutter.range;
                decorations.push(details);
            }
        }

        if (decorations.length) {
            this.editor.setDecorations(this.decoration!, decorations);
        }

        const duration = process.hrtime(start);
        Logger.log(`${(duration[0] * 1000) + Math.floor(duration[1] / 1000000)} ms to compute gutter blame annotations`);

        this.selection(shaOrLine, blame);
        return true;
    }
}