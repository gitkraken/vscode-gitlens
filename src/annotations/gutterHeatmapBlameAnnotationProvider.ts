import type { TextEditor } from 'vscode';
import { Range } from 'vscode';
import type { Container } from '../container.js';
import type { GitCommit } from '../git/models/commit.js';
import { debug } from '../system/decorators/log.js';
import { getScopedLogger } from '../system/logger.scope.js';
import { maybeStopWatch } from '../system/stopwatch.js';
import type { TrackedGitDocument } from '../trackers/trackedDocument.js';
import type { AnnotationContext, AnnotationState, DidChangeStatusCallback } from './annotationProvider.js';
import type { Decoration } from './annotations.js';
import { addOrUpdateGutterHeatmapDecoration } from './annotations.js';
import { BlameAnnotationProviderBase } from './blameAnnotationProvider.js';

export class GutterHeatmapBlameAnnotationProvider extends BlameAnnotationProviderBase {
	constructor(
		container: Container,
		onDidChangeStatus: DidChangeStatusCallback,
		editor: TextEditor,
		trackedDocument: TrackedGitDocument,
	) {
		super(container, onDidChangeStatus, 'heatmap', editor, trackedDocument);
	}

	@debug()
	override async onProvideAnnotation(_context?: AnnotationContext, state?: AnnotationState): Promise<boolean> {
		const scope = getScopedLogger();

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
