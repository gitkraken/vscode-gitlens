'use strict';
import { CancellationToken, Disposable, Hover, languages, Position, Range, TextDocument, TextEditor } from 'vscode';
import { AnnotationProviderBase } from './annotationProvider';
import { ComputedHeatmap, getHeatmapColors } from './annotations';
import { Container } from '../container';
import { GitBlame, GitBlameCommit, GitCommit } from '../git/git';
import { GitUri } from '../git/gitUri';
import { Hovers } from '../hovers/hovers';
import { log } from '../system';
import { GitDocumentState, TrackedDocument } from '../trackers/gitDocumentTracker';

export abstract class BlameAnnotationProviderBase extends AnnotationProviderBase {
	protected blame: Promise<GitBlame | undefined>;
	protected hoverProviderDisposable: Disposable | undefined;

	constructor(editor: TextEditor, trackedDocument: TrackedDocument<GitDocumentState>) {
		super(editor, trackedDocument);

		this.blame = editor.document.isDirty
			? Container.git.getBlameForFileContents(this.trackedDocument.uri, editor.document.getText())
			: Container.git.getBlameForFile(this.trackedDocument.uri);

		if (editor.document.isDirty) {
			trackedDocument.setForceDirtyStateChangeOnNextDocumentChange();
		}
	}

	clear() {
		if (this.hoverProviderDisposable != null) {
			this.hoverProviderDisposable.dispose();
			this.hoverProviderDisposable = undefined;
		}
		super.clear();
	}

	async validate(): Promise<boolean> {
		const blame = await this.blame;
		return blame != null && blame.lines.length !== 0;
	}

	protected async getBlame(): Promise<GitBlame | undefined> {
		const blame = await this.blame;
		if (blame == null || blame.lines.length === 0) return undefined;

		return blame;
	}

	@log({ args: false })
	protected async getComputedHeatmap(blame: GitBlame): Promise<ComputedHeatmap> {
		const dates: Date[] = [];

		let commit;
		let previousSha;
		for (const l of blame.lines) {
			if (previousSha === l.sha) continue;
			previousSha = l.sha;

			commit = blame.commits.get(l.sha);
			if (commit == null) continue;

			dates.push(commit.date);
		}

		dates.sort((a, b) => a.getTime() - b.getTime());

		const coldThresholdDate = new Date();
		coldThresholdDate.setDate(coldThresholdDate.getDate() - (Container.config.heatmap.ageThreshold || 90));
		const coldThresholdTimestamp = coldThresholdDate.getTime();

		const hotDates: Date[] = [];
		const coldDates: Date[] = [];

		for (const d of dates) {
			if (d.getTime() < coldThresholdTimestamp) {
				coldDates.push(d);
			} else {
				hotDates.push(d);
			}
		}

		let lookupTable:
			| number[]
			| {
					hot: number[];
					cold: number[];
			  };
		if (hotDates.length && coldDates.length) {
			lookupTable = {
				hot: getRelativeAgeLookupTable(hotDates),
				cold: getRelativeAgeLookupTable(coldDates),
			};
		} else {
			lookupTable = getRelativeAgeLookupTable(dates);
		}

		return {
			coldThresholdTimestamp: coldThresholdTimestamp,
			colors: await getHeatmapColors(),
			computeRelativeAge: (date: Date) => {
				const lookup = Array.isArray(lookupTable)
					? lookupTable
					: date.getTime() < coldThresholdTimestamp
					? lookupTable.cold
					: lookupTable.hot;

				const time = date.getTime();
				let index = 0;
				for (let i = 0; i < lookup.length; i++) {
					index = i;
					if (time >= lookup[i]) break;
				}

				return index;
			},
		};
	}

	registerHoverProviders(providers: { details: boolean; changes: boolean }) {
		if (
			!Container.config.hovers.enabled ||
			!Container.config.hovers.annotations.enabled ||
			(!providers.details && !providers.changes)
		) {
			return;
		}

		this.hoverProviderDisposable = languages.registerHoverProvider(
			{ pattern: this.document.uri.fsPath },
			{
				provideHover: (document: TextDocument, position: Position, token: CancellationToken) =>
					this.provideHover(providers, document, position, token),
			},
		);
	}

	async provideHover(
		providers: { details: boolean; changes: boolean },
		document: TextDocument,
		position: Position,
		_token: CancellationToken,
	): Promise<Hover | undefined> {
		if (Container.config.hovers.annotations.over !== 'line' && position.character !== 0) return undefined;

		const blame = await this.getBlame();
		if (blame == null) return undefined;

		const line = blame.lines[position.line];

		const commit = blame.commits.get(line.sha);
		if (commit == null) return undefined;

		const messages = (
			await Promise.all([
				providers.details ? this.getDetailsHoverMessage(commit, document) : undefined,
				providers.changes
					? Hovers.changesMessage(commit, await GitUri.fromUri(document.uri), position.line)
					: undefined,
			])
		).filter(<T>(m?: T): m is T => Boolean(m));

		return new Hover(
			messages,
			document.validateRange(new Range(position.line, 0, position.line, Number.MAX_SAFE_INTEGER)),
		);
	}

	private async getDetailsHoverMessage(commit: GitBlameCommit, document: TextDocument) {
		// Get the full commit message -- since blame only returns the summary
		let logCommit: GitCommit | undefined = undefined;
		if (!commit.isUncommitted) {
			logCommit = await Container.git.getCommitForFile(commit.repoPath, commit.uri.fsPath, {
				ref: commit.sha,
			});
			if (logCommit != null) {
				// Preserve the previous commit from the blame commit
				logCommit.previousFileName = commit.previousFileName;
				logCommit.previousSha = commit.previousSha;
			}
		}

		let editorLine = this.editor.selection.active.line;
		const line = editorLine + 1;
		const commitLine = commit.lines.find(l => l.line === line) ?? commit.lines[0];
		editorLine = commitLine.originalLine - 1;

		return Hovers.detailsMessage(
			logCommit ?? commit,
			await GitUri.fromUri(document.uri),
			editorLine,
			Container.config.defaultDateFormat,
		);
	}
}

function getRelativeAgeLookupTable(dates: Date[]) {
	const lookup: number[] = [];

	const half = Math.floor(dates.length / 2);
	const median = dates.length % 2 ? dates[half].getTime() : (dates[half - 1].getTime() + dates[half].getTime()) / 2.0;

	const newest = dates[dates.length - 1].getTime();
	let step = (newest - median) / 5;
	for (let i = 5; i > 0; i--) {
		lookup.push(median + step * i);
	}

	lookup.push(median);

	const oldest = dates[0].getTime();
	step = (median - oldest) / 4;
	for (let i = 1; i <= 4; i++) {
		lookup.push(median - step * i);
	}

	return lookup;
}
