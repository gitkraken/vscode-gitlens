'use strict';
import { Range, TextEditorDecorationType } from 'vscode';
import { FileAnnotationType } from '../configuration';
import { Container } from '../container';
import { GitBlameCommit } from '../git/git';
import { Logger } from '../logger';
import { log, Strings } from '../system';
import { Annotations } from './annotations';
import { BlameAnnotationProviderBase } from './blameAnnotationProvider';

export class HeatmapBlameAnnotationProvider extends BlameAnnotationProviderBase {
	@log()
	async onProvideAnnotation(_shaOrLine?: string | number, _type?: FileAnnotationType): Promise<boolean> {
		const cc = Logger.getCorrelationContext();

		this.annotationType = FileAnnotationType.Heatmap;

		const blame = await this.getBlame();
		if (blame == null) return false;

		let start = process.hrtime();

		const decorationsMap = new Map<string, { decoration: TextEditorDecorationType; ranges: Range[] }>();
		const computedHeatmap = await this.getComputedHeatmap(blame);

		let commit: GitBlameCommit | undefined;
		for (const l of blame.lines) {
			// editor lines are 0-based
			const editorLine = l.line - 1;

			commit = blame.commits.get(l.sha);
			if (commit == null) continue;

			Annotations.addOrUpdateGutterHeatmapDecoration(
				commit.date,
				computedHeatmap,
				new Range(editorLine, 0, editorLine, 0),
				decorationsMap,
			);
		}

		Logger.log(cc, `${Strings.getDurationMilliseconds(start)} ms to compute heatmap annotations`);

		if (decorationsMap.size) {
			start = process.hrtime();

			this.additionalDecorations = [];
			for (const d of decorationsMap.values()) {
				this.additionalDecorations.push(d);
				this.editor.setDecorations(d.decoration, d.ranges);
			}

			Logger.log(cc, `${Strings.getDurationMilliseconds(start)} ms to apply recent changes annotations`);
		}

		this.registerHoverProviders(Container.config.hovers.annotations);
		return true;
	}
}
