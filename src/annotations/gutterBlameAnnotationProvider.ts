import { DecorationOptions, Range, TextEditor, ThemableDecorationAttachmentRenderOptions } from 'vscode';
import { FileAnnotationType, GravatarDefaultStyle } from '../configuration';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { CommitFormatOptions, CommitFormatter } from '../git/formatters';
import { GitBlame, GitCommit } from '../git/models';
import { Logger } from '../logger';
import { filterMap } from '../system/array';
import { log } from '../system/decorators/log';
import { first } from '../system/iterable';
import { Stopwatch } from '../system/stopwatch';
import { getTokensFromTemplate, getWidth, TokenOptions } from '../system/string';
import { GitDocumentState } from '../trackers/gitDocumentTracker';
import { TrackedDocument } from '../trackers/trackedDocument';
import { AnnotationContext } from './annotationProvider';
import { Annotations } from './annotations';
import { BlameAnnotationProviderBase } from './blameAnnotationProvider';
import { Decorations } from './fileAnnotationController';

export class GutterBlameAnnotationProvider extends BlameAnnotationProviderBase {
	constructor(editor: TextEditor, trackedDocument: TrackedDocument<GitDocumentState>, container: Container) {
		super(FileAnnotationType.Blame, editor, trackedDocument, container);
	}

	override clear() {
		super.clear();

		if (Decorations.gutterBlameHighlight != null) {
			try {
				this.editor.setDecorations(Decorations.gutterBlameHighlight, []);
			} catch {}
		}
	}

	@log()
	async onProvideAnnotation(context?: AnnotationContext, _type?: FileAnnotationType): Promise<boolean> {
		const cc = Logger.getCorrelationContext();

		this.annotationContext = context;

		const blame = await this.getBlame();
		if (blame == null) return false;

		const sw = new Stopwatch(cc!);

		const cfg = this.container.config.blame;

		// Precalculate the formatting options so we don't need to do it on each iteration
		const tokenOptions = getTokensFromTemplate(cfg.format).reduce<{
			[token: string]: TokenOptions | undefined;
		}>((map, token) => {
			map[token.key] = token.options;
			return map;
		}, Object.create(null));

		let getBranchAndTagTips;
		if (CommitFormatter.has(cfg.format, 'tips')) {
			getBranchAndTagTips = await this.container.git.getBranchesAndTagsTipsFn(blame.repoPath);
		}

		const options: CommitFormatOptions = {
			dateFormat: cfg.dateFormat === null ? this.container.config.defaultDateFormat : cfg.dateFormat,
			getBranchAndTagTips: getBranchAndTagTips,
			tokenOptions: tokenOptions,
		};

		const avatars = cfg.avatars;
		const gravatarDefault = this.container.config.defaultGravatarsStyle;
		const separateLines = cfg.separateLines;
		const renderOptions = Annotations.gutterRenderOptions(
			separateLines,
			cfg.heatmap,
			cfg.avatars,
			cfg.format,
			options,
		);

		const decorationOptions = [];
		const decorationsMap = new Map<string, DecorationOptions | undefined>();
		const avatarDecorationsMap = avatars ? new Map<string, ThemableDecorationAttachmentRenderOptions>() : undefined;

		let commit: GitCommit | undefined;
		let compacted = false;
		let gutter: DecorationOptions | undefined;
		let previousSha: string | undefined;

		let computedHeatmap;
		if (cfg.heatmap.enabled) {
			computedHeatmap = await this.getComputedHeatmap(blame);
		}

		for (const l of blame.lines) {
			// editor lines are 0-based
			const editorLine = l.line - 1;

			if (previousSha === l.sha) {
				if (gutter == null) continue;

				// Use a shallow copy of the previous decoration options
				gutter = { ...gutter };

				if (cfg.compact && !compacted) {
					// Since we are wiping out the contextText make sure to copy the objects
					gutter.renderOptions = {
						before: {
							...gutter.renderOptions!.before,
							contentText: GlyphChars.Space.repeat(getWidth(gutter.renderOptions!.before!.contentText!)),
						},
					};

					if (separateLines) {
						gutter.renderOptions.before!.textDecoration = `none;box-sizing: border-box${
							avatars ? ';padding: 0 0 0 18px' : ''
						}`;
					}

					compacted = true;
				}

				gutter.range = new Range(editorLine, 0, editorLine, 0);

				decorationOptions.push(gutter);

				continue;
			}

			compacted = false;
			previousSha = l.sha;

			commit = blame.commits.get(l.sha);
			if (commit == null) continue;

			gutter = decorationsMap.get(l.sha);
			if (gutter != null) {
				gutter = {
					...gutter,
					range: new Range(editorLine, 0, editorLine, 0),
				};

				decorationOptions.push(gutter);

				continue;
			}

			gutter = Annotations.gutter(commit, cfg.format, options, renderOptions) as DecorationOptions;

			if (computedHeatmap != null) {
				Annotations.applyHeatmap(gutter, commit.date, computedHeatmap);
			}

			gutter.range = new Range(editorLine, 0, editorLine, 0);

			decorationOptions.push(gutter);

			if (avatars && commit.author.email != null) {
				await this.applyAvatarDecoration(commit, gutter, gravatarDefault, avatarDecorationsMap!);
			}

			decorationsMap.set(l.sha, gutter);
		}

		sw.restart({ suffix: ' to compute gutter blame annotations' });

		if (decorationOptions.length) {
			this.setDecorations([
				{ decorationType: Decorations.gutterBlameAnnotation, rangesOrOptions: decorationOptions },
			]);

			sw.stop({ suffix: ' to apply all gutter blame annotations' });
		}

		this.registerHoverProviders(this.container.config.hovers.annotations);
		return true;
	}

	@log({ args: false })
	async selection(selection?: AnnotationContext['selection'], blame?: GitBlame): Promise<void> {
		if (selection === false || Decorations.gutterBlameHighlight == null) return;

		if (blame == null) {
			blame = await this.blame;
			if (!blame?.lines.length) return;
		}

		let sha: string | undefined = undefined;
		if (selection?.sha != null) {
			sha = selection.sha;
		} else if (selection?.line != null) {
			if (selection.line >= 0) {
				const commitLine = blame.lines[selection.line];
				sha = commitLine?.sha;
			}
		} else {
			sha = first(blame.commits.values()).sha;
		}

		if (!sha) {
			this.editor.setDecorations(Decorations.gutterBlameHighlight, []);
			return;
		}

		const highlightDecorationRanges = filterMap(blame.lines, l =>
			l.sha === sha
				? // editor lines are 0-based
				  this.editor.document.validateRange(new Range(l.line - 1, 0, l.line - 1, Number.MAX_SAFE_INTEGER))
				: undefined,
		);

		this.editor.setDecorations(Decorations.gutterBlameHighlight, highlightDecorationRanges);
	}

	private async applyAvatarDecoration(
		commit: GitCommit,
		gutter: DecorationOptions,
		gravatarDefault: GravatarDefaultStyle,
		map: Map<string, ThemableDecorationAttachmentRenderOptions>,
	) {
		let avatarDecoration = map.get(commit.author.email ?? '');
		if (avatarDecoration == null) {
			const url = (await commit.getAvatarUri({ defaultStyle: gravatarDefault, size: 16 })).toString(true);
			avatarDecoration = {
				contentText: '',
				height: '16px',
				width: '16px',
				textDecoration: `none;position:absolute;top:1px;left:5px;background:url(${encodeURI(
					url,
				)});background-size:16px 16px;margin-left: 0 !important`,
			};
			map.set(commit.author.email ?? '', avatarDecoration);
		}

		gutter.renderOptions!.after = avatarDecoration;
	}
}
