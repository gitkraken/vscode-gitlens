import type { TextEditor } from 'vscode';
import { Range } from 'vscode';
import type { Container } from '../container';
import type { GitCommit } from '../git/models/commit';
import { log } from '../system/decorators/log';
import { getLogScope } from '../system/logger.scope';
import { maybeStopWatch } from '../system/stopwatch';
import type { TrackedGitDocument } from '../trackers/trackedDocument';
import type { AnnotationContext, AnnotationState, DidChangeStatusCallback } from './annotationProvider';
import type { Decoration } from './annotations';
import { addOrUpdateGutterHeatmapDecoration } from './annotations';
import { BlameAnnotationProviderBase } from './blameAnnotationProvider';

export class GutterHeatmapBlameAnnotationProvider extends BlameAnnotationProviderBase {
	constructor(
		container: Container,
		onDidChangeStatus: DidChangeStatusCallback,
		editor: TextEditor,
		trackedDocument: TrackedGitDocument,
	) {
		super(container, onDidChangeStatus, 'heatmap', editor, trackedDocument);
	}

	@log()
	override async onProvideAnnotation(_context?: AnnotationContext, state?: AnnotationState): Promise<boolean> {
		const scope = getLogScope();

		const blame = await this.getBlame(state?.recompute);
		if (blame == null) return false;

		using sw = maybeStopWatch(scope);

		const decorationsMap = new Map<string, Decoration<Range[]>>();
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

		sw?.restart({ suffix: ' to compute heatmap annotations' });

		if (decorationsMap.size) {
			this.setDecorations([...decorationsMap.values()]);

			sw?.stop({ suffix: ' to apply all heatmap annotations' });
		}

		// this.registerHoverProviders(configuration.get('hovers.annotations'));
		return true;
	}
}
