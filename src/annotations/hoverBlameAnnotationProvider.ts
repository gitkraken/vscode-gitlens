'use strict';
import { DecorationOptions, Range } from 'vscode';
import { FileAnnotationType } from './annotationController';
import { Annotations } from './annotations';
import { BlameAnnotationProviderBase } from './blameAnnotationProvider';
import { Container } from '../container';
import { GitBlameCommit } from '../gitService';
import { Logger } from '../logger';

export class HoverBlameAnnotationProvider extends BlameAnnotationProviderBase {

    async onProvideAnnotation(shaOrLine?: string | number): Promise<boolean> {
        this.annotationType = FileAnnotationType.Hover;

        const cfg = Container.config.annotations.file.hover;

        const blame = await this.getBlame();
        if (blame === undefined) return false;

        if (cfg.heatmap.enabled) {
            const start = process.hrtime();

            const now = Date.now();
            const renderOptions = Annotations.hoverRenderOptions(cfg.heatmap);

            this.decorations = [];
            const decorationsMap: { [sha: string]: DecorationOptions } = Object.create(null);

            let commit: GitBlameCommit | undefined;
            let hover: DecorationOptions | undefined;

            for (const l of blame.lines) {
                const line = l.line;

                hover = decorationsMap[l.sha];

                if (hover !== undefined) {
                    hover = {
                        ...hover,
                        range: new Range(line, 0, line, 0)
                    } as DecorationOptions;

                    this.decorations.push(hover);

                    continue;
                }

                commit = blame.commits.get(l.sha);
                if (commit === undefined) continue;

                hover = Annotations.hover(commit, renderOptions, now);
                hover.range = new Range(line, 0, line, 0);

                this.decorations.push(hover);
                decorationsMap[l.sha] = hover;

            }

            if (this.decorations.length) {
                this.editor.setDecorations(this.decoration!, this.decorations);
            }

            const duration = process.hrtime(start);
            Logger.log(`${(duration[0] * 1000) + Math.floor(duration[1] / 1000000)} ms to compute hover blame annotations`);
        }

        this.registerHoverProviders(cfg);
        this.selection(shaOrLine, blame);
        return true;
    }
}