'use strict';
import { Disposable, TextEditor } from 'vscode';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { GitBlameCommit, GitLogCommit } from '../git/git';
import {
	DocumentBlameStateChangeEvent,
	DocumentContentChangeEvent,
	DocumentDirtyIdleTriggerEvent,
	DocumentDirtyStateChangeEvent,
	GitDocumentState,
} from './gitDocumentTracker';
import { LinesChangeEvent, LineTracker } from './lineTracker';
import { Logger } from '../logger';
import { debug } from '../system';

export * from './lineTracker';

export class GitLineState {
	constructor(public readonly commit: GitBlameCommit | undefined, public logCommit?: GitLogCommit) {}
}

export class GitLineTracker extends LineTracker<GitLineState> {
	protected async fireLinesChanged(e: LinesChangeEvent) {
		this.reset();

		let updated = false;
		if (!this.suspended && !e.pending && e.lines !== undefined && e.editor !== undefined) {
			updated = await this.updateState(e.lines, e.editor);
		}

		return super.fireLinesChanged(updated ? e : { ...e, lines: undefined });
	}

	private _subscriptionOnlyWhenActive: Disposable | undefined;

	protected onStart(): Disposable | undefined {
		this.onResume();

		return Disposable.from(
			{ dispose: () => this.onSuspend() },
			Container.tracker.onDidChangeBlameState(this.onBlameStateChanged, this),
			Container.tracker.onDidChangeDirtyState(this.onDirtyStateChanged, this),
			Container.tracker.onDidTriggerDirtyIdle(this.onDirtyIdleTriggered, this),
		);
	}

	protected onResume(): void {
		if (this._subscriptionOnlyWhenActive === undefined) {
			this._subscriptionOnlyWhenActive = Container.tracker.onDidChangeContent(this.onContentChanged, this);
		}
	}

	protected onSuspend(): void {
		if (this._subscriptionOnlyWhenActive === undefined) return;

		this._subscriptionOnlyWhenActive.dispose();
		this._subscriptionOnlyWhenActive = undefined;
	}

	@debug({
		args: {
			0: (e: DocumentBlameStateChangeEvent<GitDocumentState>) =>
				`editor=${e.editor.document.uri.toString(true)}, doc=${e.document.uri.toString(true)}, blameable=${
					e.blameable
				}`,
		},
	})
	private onBlameStateChanged(e: DocumentBlameStateChangeEvent<GitDocumentState>) {
		this.trigger('editor');
	}

	@debug({
		args: {
			0: (e: DocumentContentChangeEvent<GitDocumentState>) =>
				`editor=${e.editor.document.uri.toString(true)}, doc=${e.document.uri.toString(true)}`,
		},
	})
	private onContentChanged(e: DocumentContentChangeEvent<GitDocumentState>) {
		if (e.contentChanges.some(cc => this.lines?.some(l => cc.range.start.line <= l && cc.range.end.line >= l))) {
			this.trigger('editor');
		}
	}

	@debug({
		args: {
			0: (e: DocumentDirtyIdleTriggerEvent<GitDocumentState>) =>
				`editor=${e.editor.document.uri.toString(true)}, doc=${e.document.uri.toString(true)}`,
		},
	})
	private onDirtyIdleTriggered(e: DocumentDirtyIdleTriggerEvent<GitDocumentState>) {
		const maxLines = Container.config.advanced.blame.sizeThresholdAfterEdit;
		if (maxLines > 0 && e.document.lineCount > maxLines) return;

		this.resume();
	}

	@debug({
		args: {
			0: (e: DocumentDirtyStateChangeEvent<GitDocumentState>) =>
				`editor=${e.editor.document.uri.toString(true)}, doc=${e.document.uri.toString(true)}, dirty=${
					e.dirty
				}`,
		},
	})
	private onDirtyStateChanged(e: DocumentDirtyStateChangeEvent<GitDocumentState>) {
		if (e.dirty) {
			this.suspend();
		} else {
			this.resume({ force: true });
		}
	}

	@debug({
		args: {
			0: (lines: number[]) => lines?.join(','),
			1: (editor: TextEditor) => editor.document.uri.toString(true),
		},
		exit: updated => `returned ${updated}`,
		singleLine: true,
	})
	private async updateState(lines: number[], editor: TextEditor): Promise<boolean> {
		const cc = Logger.getCorrelationContext();

		if (!this.includesAll(lines)) {
			if (cc != null) {
				cc.exitDetails = ` ${GlyphChars.Dot} lines no longer match`;
			}

			return false;
		}

		const trackedDocument = await Container.tracker.getOrAdd(editor.document);
		if (!trackedDocument.isBlameable) {
			if (cc != null) {
				cc.exitDetails = ` ${GlyphChars.Dot} document is not blameable`;
			}

			return false;
		}

		if (lines.length === 1) {
			const blameLine = editor.document.isDirty
				? await Container.git.getBlameForLineContents(trackedDocument.uri, lines[0], editor.document.getText())
				: await Container.git.getBlameForLine(trackedDocument.uri, lines[0]);
			if (blameLine === undefined) {
				if (cc != null) {
					cc.exitDetails = ` ${GlyphChars.Dot} blame failed`;
				}

				return false;
			}

			this.setState(blameLine.line.line - 1, new GitLineState(blameLine.commit));
		} else {
			const blame = editor.document.isDirty
				? await Container.git.getBlameForFileContents(trackedDocument.uri, editor.document.getText())
				: await Container.git.getBlameForFile(trackedDocument.uri);
			if (blame === undefined) {
				if (cc != null) {
					cc.exitDetails = ` ${GlyphChars.Dot} blame failed`;
				}

				return false;
			}

			for (const line of lines) {
				const commitLine = blame.lines[line];
				this.setState(line, new GitLineState(blame.commits.get(commitLine.sha)));
			}
		}

		// Check again because of the awaits above

		if (!this.includesAll(lines)) {
			if (cc != null) {
				cc.exitDetails = ` ${GlyphChars.Dot} lines no longer match`;
			}

			return false;
		}

		if (!trackedDocument.isBlameable) {
			if (cc != null) {
				cc.exitDetails = ` ${GlyphChars.Dot} document is not blameable`;
			}

			return false;
		}

		if (editor.document.isDirty) {
			trackedDocument.setForceDirtyStateChangeOnNextDocumentChange();
		}

		return true;
	}
}
