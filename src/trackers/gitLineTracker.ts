'use strict';
import { Disposable, TextEditor } from 'vscode';
import { Container } from '../container';
import { GitBlameCommit, GitLogCommit } from '../git/gitService';
import {
	DocumentBlameStateChangeEvent,
	DocumentDirtyIdleTriggerEvent,
	DocumentDirtyStateChangeEvent,
	GitDocumentState
} from './gitDocumentTracker';
import { LinesChangeEvent, LineTracker } from './lineTracker';
import { debug } from '../system';

export * from './lineTracker';

export class GitLineState {
	constructor(public readonly commit: GitBlameCommit | undefined, public logCommit?: GitLogCommit) {}
}

export class GitLineTracker extends LineTracker<GitLineState> {
	protected async fireLinesChanged(e: LinesChangeEvent) {
		this.reset();

		let updated = false;
		if (!this._suspended && !e.pending && e.lines !== undefined && e.editor !== undefined) {
			updated = await this.updateState(e.lines, e.editor);
		}

		return super.fireLinesChanged(updated ? e : { ...e, lines: undefined });
	}

	protected onStart(): Disposable | undefined {
		return Disposable.from(
			Container.tracker.onDidChangeBlameState(this.onBlameStateChanged, this),
			Container.tracker.onDidChangeDirtyState(this.onDirtyStateChanged, this),
			Container.tracker.onDidTriggerDirtyIdle(this.onDirtyIdleTriggered, this)
		);
	}

	@debug({
		args: {
			0: (e: DocumentBlameStateChangeEvent<GitDocumentState>) =>
				`editor=${e.editor.document.uri.toString(true)}, doc=${e.document.uri.toString(true)}, blameable=${
					e.blameable
				}`
		}
	})
	private onBlameStateChanged(e: DocumentBlameStateChangeEvent<GitDocumentState>) {
		this.trigger('editor');
	}

	@debug({
		args: {
			0: (e: DocumentDirtyIdleTriggerEvent<GitDocumentState>) =>
				`editor=${e.editor.document.uri.toString(true)}, doc=${e.document.uri.toString(true)}`
		}
	})
	private onDirtyIdleTriggered(e: DocumentDirtyIdleTriggerEvent<GitDocumentState>) {
		const maxLines = Container.config.advanced.blame.sizeThresholdAfterEdit;
		if (maxLines > 0 && e.document.lineCount > maxLines) return;

		this.resume();
	}

	@debug({
		args: {
			0: (e: DocumentDirtyStateChangeEvent<GitDocumentState>) =>
				`editor=${e.editor.document.uri.toString(true)}, doc=${e.document.uri.toString(true)}, dirty=${e.dirty}`
		}
	})
	private onDirtyStateChanged(e: DocumentDirtyStateChangeEvent<GitDocumentState>) {
		if (e.dirty) {
			this.suspend();
		} else {
			this.resume({ force: true });
		}
	}

	private _suspended = false;

	@debug()
	private resume(options: { force?: boolean } = {}) {
		if (!options.force && !this._suspended) return;

		this._suspended = false;
		this.trigger('editor');
	}

	@debug()
	private suspend(options: { force?: boolean } = {}) {
		if (!options.force && this._suspended) return;

		this._suspended = true;
		this.trigger('editor');
	}

	private async updateState(lines: number[], editor: TextEditor): Promise<boolean> {
		const trackedDocument = await Container.tracker.getOrAdd(editor.document);
		if (!trackedDocument.isBlameable || !this.includesAll(lines)) return false;

		if (lines.length === 1) {
			const blameLine = editor.document.isDirty
				? await Container.git.getBlameForLineContents(trackedDocument.uri, lines[0], editor.document.getText())
				: await Container.git.getBlameForLine(trackedDocument.uri, lines[0]);
			if (blameLine === undefined) return false;

			this.setState(blameLine.line.line - 1, new GitLineState(blameLine.commit));
		} else {
			const blame = editor.document.isDirty
				? await Container.git.getBlameForFileContents(trackedDocument.uri, editor.document.getText())
				: await Container.git.getBlameForFile(trackedDocument.uri);
			if (blame === undefined) return false;

			for (const line of lines) {
				const commitLine = blame.lines[line];
				this.setState(line, new GitLineState(blame.commits.get(commitLine.sha)));
			}
		}

		if (!trackedDocument.isBlameable || !this.includesAll(lines)) return false;

		if (editor.document.isDirty) {
			trackedDocument.setForceDirtyStateChangeOnNextDocumentChange();
		}

		return true;
	}
}
