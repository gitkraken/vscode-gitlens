'use strict';
import {
	MarkdownString,
	Position,
	Range,
	Selection,
	TextEditor,
	TextEditorDecorationType,
	TextEditorRevealType,
} from 'vscode';
import { AnnotationProviderBase } from './annotationProvider';
import { FileAnnotationType } from '../configuration';
import { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { Hovers } from '../hovers/hovers';
import { Logger } from '../logger';
import { log, Strings } from '../system';
import { GitDocumentState, TrackedDocument } from '../trackers/gitDocumentTracker';

export class RecentChangesAnnotationProvider extends AnnotationProviderBase {
	private readonly _uri: GitUri;

	constructor(
		editor: TextEditor,
		trackedDocument: TrackedDocument<GitDocumentState>,
		decoration: TextEditorDecorationType,
		highlightDecoration: TextEditorDecorationType | undefined,
	) {
		super(editor, trackedDocument, decoration, highlightDecoration);

		this._uri = trackedDocument.uri;
	}

	@log()
	async onProvideAnnotation(shaOrLine?: string | number): Promise<boolean> {
		const cc = Logger.getCorrelationContext();

		this.annotationType = FileAnnotationType.RecentChanges;

		let ref1 = this._uri.sha;
		let ref2;
		if (typeof shaOrLine === 'string') {
			if (shaOrLine !== this._uri.sha) {
				ref2 = `${shaOrLine}^`;
			}
		}

		const commit = await Container.git.getCommitForFile(this._uri.repoPath, this._uri.fsPath, {
			ref: ref2 ?? ref1,
		});
		if (commit === undefined) return false;

		if (ref2 !== undefined) {
			ref2 = commit.ref;
		} else {
			ref1 = commit.ref;
		}

		const diff = await Container.git.getDiffForFile(this._uri, ref1, ref2);
		if (diff === undefined) return false;

		let start = process.hrtime();

		const cfg = Container.config;
		const dateFormat = cfg.defaultDateFormat;

		this.decorations = [];

		let selection: Selection | undefined;

		for (const hunk of diff.hunks) {
			// Subtract 2 because editor lines are 0-based and we will be adding 1 in the first iteration of the loop
			let count = hunk.currentPosition.start - 2;
			for (const hunkLine of hunk.lines) {
				if (hunkLine.current === undefined) continue;

				count++;

				if (hunkLine.current.state === 'unchanged') continue;

				const range = this.editor.document.validateRange(
					new Range(new Position(count, 0), new Position(count, Number.MAX_SAFE_INTEGER)),
				);
				if (selection === undefined) {
					selection = new Selection(range.start, range.end);
				}

				let message: MarkdownString | undefined = undefined;

				if (cfg.hovers.enabled && cfg.hovers.annotations.enabled) {
					if (cfg.hovers.annotations.details) {
						this.decorations.push({
							hoverMessage: await Hovers.detailsMessage(
								commit,
								await GitUri.fromUri(this.editor.document.uri),
								count,
								dateFormat,
								this.annotationType,
							),
							range: range,
						});
					}

					if (cfg.hovers.annotations.changes) {
						message = await Hovers.changesMessage(commit, this._uri, count, hunkLine);
						if (message === undefined) continue;
					}
				}

				this.decorations.push({
					hoverMessage: message,
					range: range,
				});
			}
		}

		Logger.log(cc, `${Strings.getDurationMilliseconds(start)} ms to compute recent changes annotations`);

		if (this.decorations.length) {
			start = process.hrtime();

			this.editor.setDecorations(this.decoration, this.decorations);

			Logger.log(cc, `${Strings.getDurationMilliseconds(start)} ms to apply recent changes annotations`);

			if (selection !== undefined) {
				this.editor.selection = selection;
				this.editor.revealRange(selection, TextEditorRevealType.InCenterIfOutsideViewport);
			}
		}

		return true;
	}

	selection(shaOrLine?: string | number): Promise<void> {
		return Promise.resolve(undefined);
	}

	validate(): Promise<boolean> {
		return Promise.resolve(true);
	}
}
