import type { DecorationOptions, TextEditor, ThemableDecorationAttachmentRenderOptions } from 'vscode';
import { Range } from 'vscode';
import type { FileAnnotationType, GravatarDefaultStyle } from '../config';
import { GlyphChars } from '../constants';
import type { Container } from '../container';
import type { CommitFormatOptions } from '../git/formatters/commitFormatter';
import { CommitFormatter } from '../git/formatters/commitFormatter';
import type { GitBlame } from '../git/models/blame';
import type { GitCommit } from '../git/models/commit';
import { filterMap } from '../system/array';
import { configuration } from '../system/configuration';
import { log } from '../system/decorators/log';
import { first } from '../system/iterable';
import { getLogScope } from '../system/logger.scope';
import { maybeStopWatch } from '../system/stopwatch';
import type { TokenOptions } from '../system/string';
import { getTokensFromTemplate, getWidth } from '../system/string';
import type { GitDocumentState } from '../trackers/gitDocumentTracker';
import type { TrackedDocument } from '../trackers/trackedDocument';
import type { AnnotationContext } from './annotationProvider';
import { applyHeatmap, getGutterDecoration, getGutterRenderOptions } from './annotations';
import { BlameAnnotationProviderBase } from './blameAnnotationProvider';
import { Decorations } from './fileAnnotationController';

const maxSmallIntegerV8 = 2 ** 30; // Max number that can be stored in V8's smis (small integers)

export class GutterBlameAnnotationProvider extends BlameAnnotationProviderBase {
	constructor(editor: TextEditor, trackedDocument: TrackedDocument<GitDocumentState>, container: Container) {
		super('blame', editor, trackedDocument, container);
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
		const scope = getLogScope();

		this.annotationContext = context;

		const blame = await this.getBlame();
		if (blame == null) return false;

		const sw = maybeStopWatch(scope);

		const cfg = configuration.get('blame');

		// Precalculate the formatting options so we don't need to do it on each iteration
		const tokenOptions = getTokensFromTemplate(cfg.format).reduce<Record<string, TokenOptions | undefined>>(
			(map, token) => {
				map[token.key] = token.options;
				return map;
			},
			Object.create(null),
		);

		let getBranchAndTagTips;
		if (CommitFormatter.has(cfg.format, 'tips')) {
			getBranchAndTagTips = await this.container.git.getBranchesAndTagsTipsFn(blame.repoPath);
		}

		const options: CommitFormatOptions = {
			dateFormat: cfg.dateFormat === null ? configuration.get('defaultDateFormat') : cfg.dateFormat,
			getBranchAndTagTips: getBranchAndTagTips,
			tokenOptions: tokenOptions,
		};

		const avatars = cfg.avatars;
		const gravatarDefault = configuration.get('defaultGravatarsStyle');
		const separateLines = cfg.separateLines;
		const renderOptions = getGutterRenderOptions(separateLines, cfg.heatmap, cfg.avatars, cfg.format, options);

		const decorationOptions = [];
		const decorationsMap = new Map<string, DecorationOptions | undefined>();
		const avatarDecorationsMap = avatars ? new Map<string, ThemableDecorationAttachmentRenderOptions>() : undefined;

		let commit: GitCommit | undefined;
		let compacted = false;
		let gutter: DecorationOptions | undefined;
		let previousSha: string | undefined;

		let computedHeatmap;
		if (cfg.heatmap.enabled) {
			computedHeatmap = this.getComputedHeatmap(blame);
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

			gutter = getGutterDecoration(commit, cfg.format, options, renderOptions) as DecorationOptions;

			if (computedHeatmap != null) {
				applyHeatmap(gutter, commit.date, computedHeatmap);
			}

			gutter.range = new Range(editorLine, 0, editorLine, 0);

			decorationOptions.push(gutter);

			if (avatars && commit.author.email != null) {
				await this.applyAvatarDecoration(commit, gutter, gravatarDefault, avatarDecorationsMap!);
			}

			decorationsMap.set(l.sha, gutter);
		}

		sw?.restart({ suffix: ' to compute gutter blame annotations' });

		if (decorationOptions.length) {
			this.setDecorations([
				{ decorationType: Decorations.gutterBlameAnnotation, rangesOrOptions: decorationOptions },
			]);

			sw?.stop({ suffix: ' to apply all gutter blame annotations' });
		}

		this.registerHoverProviders(configuration.get('hovers.annotations'));
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
			sha = first(blame.commits.values())?.sha;
		}

		if (!sha) {
			this.editor.setDecorations(Decorations.gutterBlameHighlight, []);
			return;
		}

		const highlightDecorationRanges = filterMap(blame.lines, l =>
			l.sha === sha
				? // editor lines are 0-based
				  this.editor.document.validateRange(new Range(l.line - 1, 0, l.line - 1, maxSmallIntegerV8))
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
