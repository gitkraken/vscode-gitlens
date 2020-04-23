'use strict';
import { DecorationOptions, Range } from 'vscode';
import { FileAnnotationType } from '../configuration';
import { Container } from '../container';
import { GitBlameCommit } from '../git/git';
import { Logger } from '../logger';
import { log, Strings } from '../system';
import { Annotations } from './annotations';
import { BlameAnnotationProviderBase } from './blameAnnotationProvider';

export class HeatmapBlameAnnotationProvider extends BlameAnnotationProviderBase {
	@log()
	async onProvideAnnotation(shaOrLine?: string | number, type?: FileAnnotationType): Promise<boolean> {
		const cc = Logger.getCorrelationContext();

		this.annotationType = FileAnnotationType.Heatmap;

		const blame = await this.getBlame();
		if (blame === undefined) return false;

		let start = process.hrtime();

		const renderOptions = Annotations.heatmapRenderOptions();

		this.decorations = [];
		const decorationsMap: { [sha: string]: DecorationOptions | undefined } = Object.create(null);

		let commit: GitBlameCommit | undefined;
		let heatmap: DecorationOptions | undefined;

		const computedHeatmap = this.getComputedHeatmap(blame);

		for (const l of blame.lines) {
			// editor lines are 0-based
			const editorLine = l.line - 1;

			heatmap = decorationsMap[l.sha];
			if (heatmap !== undefined) {
				heatmap = {
					...heatmap,
					range: new Range(editorLine, 0, editorLine, 0),
				};

				this.decorations.push(heatmap);

				continue;
			}

			commit = blame.commits.get(l.sha);
			if (commit === undefined) continue;

			heatmap = Annotations.heatmap(commit, computedHeatmap, renderOptions) as DecorationOptions;
			heatmap.range = new Range(editorLine, 0, editorLine, 0);

			this.decorations.push(heatmap);
			decorationsMap[l.sha] = heatmap;
		}

		Logger.log(cc, `${Strings.getDurationMilliseconds(start)} ms to compute heatmap annotations`);

		if (this.decorations.length) {
			start = process.hrtime();

			this.editor.setDecorations(this.decoration, this.decorations);

			Logger.log(cc, `${Strings.getDurationMilliseconds(start)} ms to apply recent changes annotations`);
		}

		this.registerHoverProviders(Container.config.hovers.annotations);
		return true;
	}
}
