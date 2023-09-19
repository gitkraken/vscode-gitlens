import type { TextEditor } from 'vscode';
import { Disposable } from 'vscode';
import { GlyphChars } from '../constants';
import type { Container } from '../container';
import type { GitCommit } from '../git/models/commit';
import { configuration } from '../system/configuration';
import { debug } from '../system/decorators/log';
import { getLogScope, setLogScopeExit } from '../system/logger.scope';
import type {
	DocumentBlameStateChangeEvent,
	DocumentContentChangeEvent,
	DocumentDirtyIdleTriggerEvent,
	DocumentDirtyStateChangeEvent,
	GitDocumentState,
} from './gitDocumentTracker';
import type { LinesChangeEvent, LineSelection } from './lineTracker';
import { LineTracker } from './lineTracker';

export * from './lineTracker';

export interface GitLineState {
	commit: GitCommit;
}

export class GitLineTracker extends LineTracker<GitLineState> {
	constructor(private readonly container: Container) {
		super();
	}

	protected override async fireLinesChanged(e: LinesChangeEvent) {
		let updated = false;
		if (!this.suspended && !e.pending && e.selections != null && e.editor != null) {
			updated = await this.updateState(e.selections, e.editor);
		}

		super.fireLinesChanged(updated ? e : { ...e, selections: undefined });
	}

	private _subscriptionOnlyWhenActive: Disposable | undefined;

	protected override onStart(): Disposable | undefined {
		this.onResume();

		return Disposable.from(
			{ dispose: () => this.onSuspend() },
			this.container.tracker.onDidChangeBlameState(this.onBlameStateChanged, this),
			this.container.tracker.onDidChangeDirtyState(this.onDirtyStateChanged, this),
			this.container.tracker.onDidTriggerDirtyIdle(this.onDirtyIdleTriggered, this),
		);
	}

	protected override onResume(): void {
		if (this._subscriptionOnlyWhenActive == null) {
			this._subscriptionOnlyWhenActive = this.container.tracker.onDidChangeContent(this.onContentChanged, this);
		}
	}

	protected override onSuspend(): void {
		this._subscriptionOnlyWhenActive?.dispose();
		this._subscriptionOnlyWhenActive = undefined;
	}

	@debug<GitLineTracker['onBlameStateChanged']>({
		args: {
			0: e => `editor/doc=${e.editor.document.uri.toString(true)}, blameable=${e.blameable}`,
		},
	})
	private onBlameStateChanged(_e: DocumentBlameStateChangeEvent<GitDocumentState>) {
		this.notifyLinesChanged('editor');
	}

	@debug<GitLineTracker['onContentChanged']>({
		args: {
			0: e => `editor/doc=${e.editor.document.uri.toString(true)}`,
		},
	})
	private onContentChanged(e: DocumentContentChangeEvent<GitDocumentState>) {
		if (
			e.contentChanges.some(
				scope =>
					this.selections?.some(
						selection =>
							(scope.range.end.line >= selection.active && selection.active >= scope.range.start.line) ||
							(scope.range.start.line >= selection.active && selection.active >= scope.range.end.line),
					),
			)
		) {
			this.notifyLinesChanged('editor');
		}
	}

	@debug<GitLineTracker['onDirtyIdleTriggered']>({
		args: {
			0: e => `editor/doc=${e.editor.document.uri.toString(true)}`,
		},
	})
	private onDirtyIdleTriggered(e: DocumentDirtyIdleTriggerEvent<GitDocumentState>) {
		const maxLines = configuration.get('advanced.blame.sizeThresholdAfterEdit');
		if (maxLines > 0 && e.document.lineCount > maxLines) return;

		this.resume();
	}

	@debug<GitLineTracker['onDirtyStateChanged']>({
		args: {
			0: e => `editor/doc=${e.editor.document.uri.toString(true)}, dirty=${e.dirty}`,
		},
	})
	private onDirtyStateChanged(e: DocumentDirtyStateChangeEvent<GitDocumentState>) {
		if (e.dirty) {
			this.suspend();
		} else {
			this.resume({ force: true });
		}
	}

	@debug<GitLineTracker['updateState']>({
		args: { 0: selections => selections?.map(s => s.active).join(','), 1: e => e.document.uri.toString(true) },
		exit: true,
	})
	private async updateState(selections: LineSelection[], editor: TextEditor): Promise<boolean> {
		const scope = getLogScope();

		if (!this.includes(selections)) {
			setLogScopeExit(scope, ` ${GlyphChars.Dot} lines no longer match`);

			return false;
		}

		const trackedDocument = await this.container.tracker.getOrAdd(editor.document);
		if (!trackedDocument.isBlameable) {
			setLogScopeExit(scope, ` ${GlyphChars.Dot} document is not blameable`);

			return false;
		}

		if (selections.length === 1) {
			const blameLine = await this.container.git.getBlameForLine(
				trackedDocument.uri,
				selections[0].active,
				editor?.document,
			);
			if (blameLine == null) {
				setLogScopeExit(scope, ` ${GlyphChars.Dot} blame failed`);

				return false;
			}

			if (blameLine.commit != null && blameLine.commit.file == null) {
				debugger;
			}

			this.setState(blameLine.line.line - 1, { commit: blameLine.commit });
		} else {
			const blame = await this.container.git.getBlame(trackedDocument.uri, editor.document);
			if (blame == null) {
				setLogScopeExit(scope, ` ${GlyphChars.Dot} blame failed`);

				return false;
			}

			for (const selection of selections) {
				const commitLine = blame.lines[selection.active];
				const commit = blame.commits.get(commitLine.sha);
				if (commit != null && commit.file == null) {
					debugger;
				}

				if (commit == null) {
					debugger;
					this.resetState(selection.active);
				} else {
					this.setState(selection.active, { commit: commit });
				}
			}
		}

		// Check again because of the awaits above

		if (!this.includes(selections)) {
			setLogScopeExit(scope, ` ${GlyphChars.Dot} lines no longer match`);

			return false;
		}

		if (!trackedDocument.isBlameable) {
			setLogScopeExit(scope, ` ${GlyphChars.Dot} document is not blameable`);

			return false;
		}

		if (editor.document.isDirty) {
			trackedDocument.setForceDirtyStateChangeOnNextDocumentChange();
		}

		return true;
	}
}
