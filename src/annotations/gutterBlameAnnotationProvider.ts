'use strict';
import { DecorationOptions, Range, TextEditorDecorationType, window } from 'vscode';
import { FileAnnotationType, GravatarDefaultStyle } from '../configuration';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { CommitFormatOptions, CommitFormatter, GitBlameCommit } from '../git/gitService';
import { Logger } from '../logger';
import { log, Objects, Strings } from '../system';
import { Annotations } from './annotations';
import { BlameAnnotationProviderBase } from './blameAnnotationProvider';

export class GutterBlameAnnotationProvider extends BlameAnnotationProviderBase {
	@log()
	async onProvideAnnotation(shaOrLine?: string | number, type?: FileAnnotationType): Promise<boolean> {
		const cc = Logger.getCorrelationContext();

		this.annotationType = FileAnnotationType.Blame;

		const blame = await this.getBlame();
		if (blame === undefined) return false;

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
			tokenOptions: tokenOptions
		};

		const avatars = cfg.avatars;
		const gravatarDefault = Container.config.defaultGravatarsStyle;
		const separateLines = cfg.separateLines;
		const renderOptions = Annotations.gutterRenderOptions(separateLines, cfg.heatmap, cfg.format, options);

		this.decorations = [];
		const decorationsMap: { [sha: string]: DecorationOptions | undefined } = Object.create(null);
		const avatarDecorationsMap:
			| { [email: string]: { decoration: TextEditorDecorationType; ranges: Range[] } }
			| undefined = avatars ? Object.create(null) : undefined;

		let commit: GitBlameCommit | undefined;
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
				if (gutter === undefined) continue;

				// Use a shallow copy of the previous decoration options
				gutter = { ...gutter };

				if (cfg.compact && !compacted) {
					// Since we are wiping out the contextText make sure to copy the objects
					gutter.renderOptions = {
						before: {
							...gutter.renderOptions!.before,
							contentText: GlyphChars.Space.repeat(
								Strings.getWidth(gutter.renderOptions!.before!.contentText!)
							)
						}
					};

					if (separateLines) {
						gutter.renderOptions.before!.textDecoration = 'none';
					}

					compacted = true;
				}

				gutter.range = new Range(editorLine, 0, editorLine, 0);

				this.decorations.push(gutter);

				if (avatars && !cfg.compact && commit !== undefined && commit.email !== undefined) {
					this.addOrUpdateGravatarDecoration(commit, gutter.range, gravatarDefault, avatarDecorationsMap!);
				}

				continue;
			}

			compacted = false;
			previousSha = l.sha;

			commit = blame.commits.get(l.sha);
			if (commit === undefined) continue;

			gutter = decorationsMap[l.sha];
			if (gutter !== undefined) {
				gutter = {
					...gutter,
					range: new Range(editorLine, 0, editorLine, 0)
				};

				this.decorations.push(gutter);

				if (avatars && commit.email !== undefined) {
					this.addOrUpdateGravatarDecoration(commit, gutter.range, gravatarDefault, avatarDecorationsMap!);
				}

				continue;
			}

			gutter = Annotations.gutter(commit, cfg.format, options, renderOptions) as DecorationOptions;

			if (computedHeatmap !== undefined) {
				Annotations.applyHeatmap(gutter, commit.date, computedHeatmap);
			}

			gutter.range = new Range(editorLine, 0, editorLine, 0);

			this.decorations.push(gutter);

			if (avatars && commit.email !== undefined) {
				this.addOrUpdateGravatarDecoration(commit, gutter.range, gravatarDefault, avatarDecorationsMap!);
			}

			decorationsMap[l.sha] = gutter;
		}

		Logger.log(cc, `${Strings.getDurationMilliseconds(start)} ms to compute gutter blame annotations`);

		if (this.decorations.length) {
			start = process.hrtime();

			this.editor.setDecorations(this.decoration, this.decorations);

			if (avatars) {
				this.additionalDecorations = [];
				for (const d of Objects.values(avatarDecorationsMap!)) {
					this.additionalDecorations.push(d);
					this.editor.setDecorations(d.decoration, d.ranges);
				}
			}

			Logger.log(cc, `${Strings.getDurationMilliseconds(start)} ms to apply all gutter blame annotations`);
		}

		this.registerHoverProviders(Container.config.hovers.annotations);
		return true;
	}

	addOrUpdateGravatarDecoration(
		commit: GitBlameCommit,
		range: Range,
		gravatarDefault: GravatarDefaultStyle,
		map: { [email: string]: { decoration: TextEditorDecorationType; ranges: Range[] } }
	) {
		const avatarDecoration = map[commit.email!];
		if (avatarDecoration !== undefined) {
			avatarDecoration.ranges.push(range);

			return;
		}

		map[commit.email!] = {
			decoration: window.createTextEditorDecorationType({
				gutterIconPath: commit.getGravatarUri(gravatarDefault),
				gutterIconSize: '16px 16px'
			}),
			ranges: [range]
		};
	}
}
