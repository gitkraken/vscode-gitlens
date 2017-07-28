'use strict';
import { Strings } from '../system';
import { DecorationOptions, Range } from 'vscode';
import { FileAnnotationType } from './annotationController';
import { Annotations, endOfLineIndex } from './annotations';
import { BlameAnnotationProviderBase } from './blameAnnotationProvider';
import { GlyphChars } from '../constants';
import { GitBlameCommit, ICommitFormatOptions } from '../gitService';
import * as moment from 'moment';

export class GutterBlameAnnotationProvider extends BlameAnnotationProviderBase {

    async provideAnnotation(shaOrLine?: string | number, type?: FileAnnotationType): Promise<boolean> {
        this.annotationType = FileAnnotationType.Gutter;

        const blame = await this.getBlame(true);
        if (blame === undefined) return false;

        // console.time('Computing blame annotations...');

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

        const now = moment();
        const offset = this.uri.offset;
        const renderOptions = Annotations.gutterRenderOptions(this._config.theme, cfg.heatmap);
        const dateFormat = this._config.defaultDateFormat;

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
                    gutter.renderOptions.before = { ...gutter.renderOptions.before, ...{ contentText: GlyphChars.Space.repeat(gutter.renderOptions!.before!.contentText!.length) } }; // !.before!.contentText = GlyphChars.Space.repeat(gutter.renderOptions!.before!.contentText!.length);
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
            gutter = Annotations.gutter(commit, cfg.format, options, renderOptions);

            // TODO: Remove this "if" once vscode 1.15 ships - since empty lines won't be "missing" anymore -- Woo!
            if (cfg.compact) {
                const isEmptyOrWhitespace = document.lineAt(line).isEmptyOrWhitespace;
                previousSha = isEmptyOrWhitespace ? undefined : l.sha;
            }
            else {
                previousSha = l.sha;
            }

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

        // console.timeEnd('Computing blame annotations...');

        this.selection(shaOrLine, blame);
        return true;
    }
}