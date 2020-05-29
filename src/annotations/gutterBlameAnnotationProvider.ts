'use strict';
import { DecorationOptions, Range, ThemableDecorationAttachmentRenderOptions } from 'vscode';
import { FileAnnotationType, GravatarDefaultStyle } from '../configuration';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { CommitFormatOptions, CommitFormatter, GitBlameCommit } from '../git/git';
import { Logger } from '../logger';
import { log, Strings } from '../system';
import { Annotations } from './annotations';
import { BlameAnnotationProviderBase } from './blameAnnotationProvider';

export class GutterBlameAnnotationProvider extends BlameAnnotationProviderBase {
	@log()
	async onProvideAnnotation(_shaOrLine?: string | number, _type?: FileAnnotationType): Promise<boolean> {
		const cc = Logger.getCorrelationContext();

		this.annotationType = FileAnnotationType.Blame;

		const blame = await this.getBlame();
		if (blame == null) return false;

		let start = process.hrtime();

		const cfg = Container.config.blame;

		// Precalculate the formatting options so we don't need to do it on each iteration
		const tokenOptions = Strings.getTokensFromTemplate(cfg.format).reduce<{
			[token: string]: Strings.TokenOptions | undefined;
		}>((map, token) => {
			map[token.key] = token.options;
			return map;
		}, Object.create(null));

		let getBranchAndTagTips;
		if (CommitFormatter.has(cfg.format, 'tips')) {
			getBranchAndTagTips = await Container.git.getBranchesAndTagsTipsFn(blame.repoPath);
		}

		const options: CommitFormatOptions = {
			dateFormat: cfg.dateFormat === null ? Container.config.defaultDateFormat : cfg.dateFormat,
			getBranchAndTagTips: getBranchAndTagTips,
			tokenOptions: tokenOptions,
		};

		const avatars = cfg.avatars;
		const gravatarDefault = Container.config.defaultGravatarsStyle;
		const separateLines = cfg.separateLines;
		const renderOptions = Annotations.gutterRenderOptions(
			separateLines,
			cfg.heatmap,
			cfg.avatars,
			cfg.format,
			options,
		);

		this.decorations = [];
		const decorationsMap = new Map<string, DecorationOptions | undefined>();
		const avatarDecorationsMap = avatars ? new Map<string, ThemableDecorationAttachmentRenderOptions>() : undefined;

		let commit: GitBlameCommit | undefined;
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
							contentText: GlyphChars.Space.repeat(
								Strings.getWidth(gutter.renderOptions!.before!.contentText!),
							),
						},
					};

					if (separateLines) {
						gutter.renderOptions.before!.textDecoration = `none;box-sizing:border-box${
							avatars ? ';padding: 0 0 0 18px' : ''
						}`;
					}

					compacted = true;
				}

				gutter.range = new Range(editorLine, 0, editorLine, 0);

				this.decorations.push(gutter);

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

				this.decorations.push(gutter);

				continue;
			}

			gutter = Annotations.gutter(commit, cfg.format, options, renderOptions) as DecorationOptions;

			if (computedHeatmap != null) {
				Annotations.applyHeatmap(gutter, commit.date, computedHeatmap);
			}

			gutter.range = new Range(editorLine, 0, editorLine, 0);

			this.decorations.push(gutter);

			if (avatars && commit.email != null) {
				this.applyAvatarDecoration(commit, gutter, gravatarDefault, avatarDecorationsMap!);
			}

			decorationsMap.set(l.sha, gutter);
		}

		Logger.log(cc, `${Strings.getDurationMilliseconds(start)} ms to compute gutter blame annotations`);

		if (this.decoration != null && this.decorations.length) {
			start = process.hrtime();

			this.editor.setDecorations(this.decoration, this.decorations);

			Logger.log(cc, `${Strings.getDurationMilliseconds(start)} ms to apply all gutter blame annotations`);
		}

		this.registerHoverProviders(Container.config.hovers.annotations);
		return true;
	}

	applyAvatarDecoration(
		commit: GitBlameCommit,
		gutter: DecorationOptions,
		gravatarDefault: GravatarDefaultStyle,
		map: Map<string, ThemableDecorationAttachmentRenderOptions>,
	) {
		let avatarDecoration = map.get(commit.email!);
		if (avatarDecoration == null) {
			avatarDecoration = {
				contentIconPath: commit.getAvatarUri(gravatarDefault),
				height: '16px',
				width: '16px',
				textDecoration: 'none;position:absolute;top:1px;left:5px',
			};
			map.set(commit.email!, avatarDecoration);
		}

		gutter.renderOptions!.after = avatarDecoration;
	}
}
