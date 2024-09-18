import type { CancellationToken, Disposable, Position, TextDocument, TextEditor } from 'vscode';
import { Hover, languages, Range } from 'vscode';
import type { FileAnnotationType } from '../config';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import type { GitBlame } from '../git/models/blame';
import type { GitCommit } from '../git/models/commit';
import { changesMessage, detailsMessage } from '../hovers/hovers';
import { log } from '../system/decorators/log';
import { configuration } from '../system/vscode/configuration';
import type { TrackedGitDocument } from '../trackers/trackedDocument';
import type { DidChangeStatusCallback } from './annotationProvider';
import { AnnotationProviderBase } from './annotationProvider';
import type { ComputedHeatmap } from './annotations';
import { getHeatmapColors } from './annotations';

const maxSmallIntegerV8 = 2 ** 30 - 1; // Max number that can be stored in V8's smis (small integers)

export abstract class BlameAnnotationProviderBase extends AnnotationProviderBase {
	protected blame: Promise<GitBlame | undefined>;
	protected hoverProviderDisposable: Disposable | undefined;

	constructor(
		container: Container,
		onDidChangeStatus: DidChangeStatusCallback,
		annotationType: FileAnnotationType,
		editor: TextEditor,
		trackedDocument: TrackedGitDocument,
	) {
		super(container, onDidChangeStatus, annotationType, editor, trackedDocument);

		this.blame = container.git.getBlame(this.trackedDocument.uri, editor.document);

		if (editor.document.isDirty) {
			trackedDocument.setForceDirtyStateChangeOnNextDocumentChange();
		}
	}

	override clear() {
		if (this.hoverProviderDisposable != null) {
			this.hoverProviderDisposable.dispose();
			this.hoverProviderDisposable = undefined;
		}
		return super.clear();
	}

	override async validate(): Promise<boolean> {
		const blame = await this.blame;
		return Boolean(blame?.lines.length);
	}

	protected async getBlame(force?: boolean): Promise<GitBlame | undefined> {
		if (force) {
			this.blame = this.container.git.getBlame(this.trackedDocument.uri, this.editor.document);
		}
		const blame = await this.blame;
		if (!blame?.lines.length) return undefined;

		return blame;
	}

	@log({ args: false })
	protected getComputedHeatmap(blame: GitBlame): ComputedHeatmap {
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
		coldThresholdDate.setDate(coldThresholdDate.getDate() - (configuration.get('heatmap.ageThreshold') || 90));
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

		const getLookupTable = (date: Date, unified?: boolean) =>
			Array.isArray(lookupTable)
				? lookupTable
				: unified
				  ? lookupTable.hot.concat(lookupTable.cold)
				  : date.getTime() < coldThresholdTimestamp
				    ? lookupTable.cold
				    : lookupTable.hot;

		const computeRelativeAge = (date: Date, lookup: number[]) => {
			const time = date.getTime();
			let index = 0;
			for (let i = 0; i < lookup.length; i++) {
				index = i;
				if (time >= lookup[i]) break;
			}

			return index;
		};

		return {
			coldThresholdTimestamp: coldThresholdTimestamp,
			colors: getHeatmapColors(),
			computeRelativeAge: (date: Date) => computeRelativeAge(date, getLookupTable(date)),
			computeOpacity: (date: Date) => {
				const lookup = getLookupTable(date, true);
				const age = computeRelativeAge(date, lookup);

				return Math.max(0.2, Math.round((1 - age / lookup.length) * 100) / 100);
			},
		};
	}

	registerHoverProviders(providers: { details: boolean; changes: boolean }) {
		const cfg = configuration.get('hovers');
		if (!cfg.enabled || !cfg.annotations.enabled || (!providers.details && !providers.changes)) {
			return;
		}

		this.hoverProviderDisposable?.dispose();
		this.hoverProviderDisposable = languages.registerHoverProvider(
			{ pattern: this.editor.document.uri.fsPath },
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
		if (configuration.get('hovers.annotations.over') !== 'line' && position.character !== 0) return undefined;

		if (this.editor.document.uri.toString() !== document.uri.toString()) return undefined;

		const blame = await this.getBlame();
		if (blame == null) return undefined;

		const line = blame.lines[position.line];

		const commit = blame.commits.get(line.sha);
		if (commit == null) return undefined;

		const messages = (
			await Promise.all([
				providers.details ? this.getDetailsHoverMessage(commit, document) : undefined,
				providers.changes
					? changesMessage(
							this.container,
							commit,
							await GitUri.fromUri(document.uri),
							position.line,
							document,
					  )
					: undefined,
			])
		).filter(<T>(m?: T): m is T => Boolean(m));

		return new Hover(
			messages,
			document.validateRange(new Range(position.line, 0, position.line, maxSmallIntegerV8)),
		);
	}

	private async getDetailsHoverMessage(commit: GitCommit, document: TextDocument) {
		let editorLine = this.editor.selection.active.line;
		const line = editorLine + 1;
		const commitLine = commit.lines.find(l => l.line === line) ?? commit.lines[0];
		editorLine = commitLine.originalLine - 1;

		const cfg = configuration.get('hovers');
		return detailsMessage(this.container, commit, await GitUri.fromUri(document.uri), editorLine, {
			autolinks: cfg.autolinks.enabled,
			dateFormat: configuration.get('defaultDateFormat'),
			format: cfg.detailsMarkdownFormat,
			pullRequests: cfg.pullRequests.enabled,
			timeout: 250,
		});
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
