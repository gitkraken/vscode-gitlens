'use strict';
import { DecorationOptions, Range } from 'vscode';
import { FileAnnotationType } from './annotationController';
import { Annotations, endOfLineIndex } from './annotations';
import { BlameAnnotationProviderBase } from './blameAnnotationProvider';
import { GitBlameCommit } from '../gitService';
import * as moment from 'moment';

export class HoverBlameAnnotationProvider extends BlameAnnotationProviderBase {

    async provideAnnotation(shaOrLine?: string | number): Promise<boolean> {
        this.annotationType = FileAnnotationType.Hover;

        const blame = await this.getBlame(this._config.annotations.file.hover.heatmap.enabled);
        if (blame === undefined) return false;

        // console.time('Computing blame annotations...');

        const cfg = this._config.annotations.file.hover;

        const now = moment();
        const offset = this.uri.offset;
        const renderOptions = Annotations.hoverRenderOptions(this._config.theme, cfg.heatmap);
        const dateFormat = this._config.defaultDateFormat;

        const decorations: DecorationOptions[] = [];

        let commit: GitBlameCommit | undefined;
        let hover: DecorationOptions | undefined;

        for (const l of blame.lines) {
            commit = blame.commits.get(l.sha);
            if (commit === undefined) continue;

            const line = l.line + offset;

            hover = Annotations.hover(commit, renderOptions, cfg.heatmap.enabled, dateFormat);

            const endIndex = cfg.wholeLine ? endOfLineIndex : this.editor.document.lineAt(line).firstNonWhitespaceCharacterIndex;
            hover.range = this.editor.document.validateRange(new Range(line, 0, line, endIndex));

            if (cfg.heatmap.enabled) {
                Annotations.applyHeatmap(hover, commit.date, now);
            }

            decorations.push(hover);
        }

        if (decorations.length) {
            this.editor.setDecorations(this.decoration!, decorations);
        }

        // console.timeEnd('Computing blame annotations...');

        this.selection(shaOrLine, blame);
        return true;
    }
}