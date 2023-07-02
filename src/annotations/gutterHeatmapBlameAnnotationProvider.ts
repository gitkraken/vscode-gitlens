import type { TextEditor, TextEditorDecorationType } from 'vscode';
import { Range } from 'vscode';
import { FileAnnotationType } from '../config';
import type { Container } from '../container';
import type { GitCommit } from '../git/models/commit';
import { log } from '../system/decorators/log';
import { getLogScope } from '../system/logger.scope';
import { Stopwatch } from '../system/stopwatch';
import type { GitDocumentState } from '../trackers/gitDocumentTracker';
import type { TrackedDocument } from '../trackers/trackedDocument';
import type { AnnotationContext } from './annotationProvider';
import { addOrUpdateGutterHeatmapDecoration } from './annotations';
import { BlameAnnotationProviderBase } from './blameAnnotationProvider';

export class GutterHeatmapBlameAnnotationProvider extends BlameAnnotationProviderBase {
	constructor(editor: TextEditor, trackedDocument: TrackedDocument<GitDocumentState>, container: Container) {
		super(FileAnnotationType.Heatmap, editor, trackedDocument, container);
	}

	@log()
	async onProvideAnnotation(context?: AnnotationContext, _type?: FileAnnotationType): Promise<boolean> {
		const scope = getLogScope();

		this.annotationContext = context;

		const blame = await this.getBlame();
		if (blame == null) return false;

		const sw = new Stopwatch(scope);

		const decorationsMap = new Map<
			string,
			{ decorationType: TextEditorDecorationType; rangesOrOptions: Range[] }
		>();
		const computedHeatmap = this.getComputedHeatmap(blame);

		let commit: GitCommit | undefined;
		for (const l of blame.lines) {
			// editor lines are 0-based
			const editorLine = l.line - 1;

			commit = blame.commits.get(l.sha);
			if (commit == null) continue;

			addOrUpdateGutterHeatmapDecoration(
				commit.date,
				computedHeatmap,
				new Range(editorLine, 0, editorLine, 0),
				decorationsMap,
			);
		}

		sw.restart({ suffix: ' to compute heatmap annotations' });

		if (decorationsMap.size) {
			this.setDecorations([...decorationsMap.values()]);

			sw.stop({ suffix: ' to apply all heatmap annotations' });
		}

		// this.registerHoverProviders(configuration.get('hovers.annotations'));
		return true;
	}

	selection(_selection?: AnnotationContext['selection']): Promise<void> {
		return Promise.resolve();
	}
}
