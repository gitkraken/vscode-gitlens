import { Range, TextEditor, TextEditorDecorationType } from 'vscode';
import { FileAnnotationType } from '../configuration';
import { Container } from '../container';
import { GitCommit } from '../git/models';
import { Logger } from '../logger';
import { log } from '../system/decorators/log';
import { Stopwatch } from '../system/stopwatch';
import { GitDocumentState } from '../trackers/gitDocumentTracker';
import { TrackedDocument } from '../trackers/trackedDocument';
import { AnnotationContext } from './annotationProvider';
import { Annotations } from './annotations';
import { BlameAnnotationProviderBase } from './blameAnnotationProvider';

export class GutterHeatmapBlameAnnotationProvider extends BlameAnnotationProviderBase {
	constructor(editor: TextEditor, trackedDocument: TrackedDocument<GitDocumentState>, container: Container) {
		super(FileAnnotationType.Heatmap, editor, trackedDocument, container);
	}

	@log()
	async onProvideAnnotation(context?: AnnotationContext, _type?: FileAnnotationType): Promise<boolean> {
		const cc = Logger.getCorrelationContext();

		this.annotationContext = context;

		const blame = await this.getBlame();
		if (blame == null) return false;

		const sw = new Stopwatch(cc!);

		const decorationsMap = new Map<
			string,
			{ decorationType: TextEditorDecorationType; rangesOrOptions: Range[] }
		>();
		const computedHeatmap = await this.getComputedHeatmap(blame);

		let commit: GitCommit | undefined;
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

		sw.restart({ suffix: ' to compute heatmap annotations' });

		if (decorationsMap.size) {
			this.setDecorations([...decorationsMap.values()]);

			sw.stop({ suffix: ' to apply all heatmap annotations' });
		}

		// this.registerHoverProviders(this.container.config.hovers.annotations);
		return true;
	}

	selection(_selection?: AnnotationContext['selection']): Promise<void> {
		return Promise.resolve();
	}
}
