'use strict';
import { Strings } from '../system';
import { DecorationOptions, Range } from 'vscode';
import { FileAnnotationType } from './annotationController';
import { BlameAnnotationProviderBase } from './blameAnnotationProvider';
import { Annotations, endOfLineIndex } from './annotations';
import { ICommitFormatOptions } from '../gitService';
import * as moment from 'moment';

export class GutterBlameAnnotationProvider extends BlameAnnotationProviderBase {

    async provideAnnotation(shaOrLine?: string | number, type?: FileAnnotationType): Promise<boolean> {
        this.annotationType = FileAnnotationType.Gutter;

        const blame = await this.getBlame(true);
        if (blame === undefined) return false;

        const cfg = this._config.annotations.file.gutter;

        // Precalculate the formatting options so we don't need to do it on each iteration
        const tokenOptions = Strings.getTokensFromTemplate(cfg.format)
            .reduce((map, token) => {
                map[token.key] = token.options;
                return map;
            }, {} as { [token: string]: ICommitFormatOptions });

        const options: ICommitFormatOptions = {
            dateFormat: cfg.dateFormat === null ? this._config.defaultDateFormat : cfg.dateFormat,
            tokenOptions: tokenOptions
        };

        const now = moment();
        const offset = this.uri.offset;
        let previousLine: string | undefined = undefined;
        const renderOptions = Annotations.gutterRenderOptions(this._config.theme, cfg.heatmap);
        const dateFormat = this._config.defaultDateFormat;

        const decorations: DecorationOptions[] = [];

        for (const l of blame.lines) {
            const commit = blame.commits.get(l.sha);
            if (commit === undefined) continue;

            const line = l.line + offset;

            const gutter = Annotations.gutter(commit, cfg.format, options, renderOptions, cfg.compact && previousLine === l.sha);

            if (cfg.compact) {
                const isEmptyOrWhitespace = this.document.lineAt(line).isEmptyOrWhitespace;
                previousLine = isEmptyOrWhitespace ? undefined : l.sha;
            }

            if (cfg.heatmap.enabled) {
                Annotations.applyHeatmap(gutter, commit.date, now);
            }

            const firstNonWhitespace = this.editor.document.lineAt(line).firstNonWhitespaceCharacterIndex;
            gutter.range = this.editor.document.validateRange(new Range(line, 0, line, firstNonWhitespace));
            decorations.push(gutter);

            if (cfg.hover.details) {
                const details = Annotations.detailsHover(commit, dateFormat);
                details.range = cfg.hover.wholeLine
                    ? this.editor.document.validateRange(new Range(line, 0, line, endOfLineIndex))
                    : gutter.range;
                decorations.push(details);
            }
        }

        if (decorations.length) {
            this.editor.setDecorations(this.decoration!, decorations);
        }

        this.selection(shaOrLine, blame);
        return true;
    }
}