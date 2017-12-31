'use strict';
import { DecorationOptions, Range } from 'vscode';
import { FileAnnotationType } from './annotationController';
import { Annotations } from './annotations';
import { BlameAnnotationProviderBase } from './blameAnnotationProvider';
import { GitBlameCommit } from '../gitService';
import { Logger } from '../logger';

export class HeatmapBlameAnnotationProvider extends BlameAnnotationProviderBase {

    async provideAnnotation(shaOrLine?: string | number, type?: FileAnnotationType): Promise<boolean> {
        this.annotationType = FileAnnotationType.Heatmap;

        const blame = await this.getBlame();
        if (blame === undefined) return false;

        const start = process.hrtime();

        const now = Date.now();
        const renderOptions = Annotations.heatmapRenderOptions();

        this._decorations = [];
        const decorationsMap: { [sha: string]: DecorationOptions | undefined } = Object.create(null);

        let commit: GitBlameCommit | undefined;
        let heatmap: DecorationOptions | undefined;

        for (const l of blame.lines) {
            const line = l.line;

            heatmap = decorationsMap[l.sha];
            if (heatmap !== undefined) {
                heatmap = {
                    ...heatmap,
                    range: new Range(line, 0, line, 0)
                } as DecorationOptions;

                this._decorations.push(heatmap);

                continue;
            }

            commit = blame.commits.get(l.sha);
            if (commit === undefined) continue;

            heatmap = Annotations.heatmap(commit, now, renderOptions);
            heatmap.range = new Range(line, 0, line, 0);

            this._decorations.push(heatmap);
            decorationsMap[l.sha] = heatmap;
        }

        if (this._decorations.length) {
            this.editor.setDecorations(this.decoration!, this._decorations);
        }

        const duration = process.hrtime(start);
        Logger.log(`${(duration[0] * 1000) + Math.floor(duration[1] / 1000000)} ms to compute heatmap annotations`);

        this.selection(shaOrLine, blame);
        return true;
    }
}