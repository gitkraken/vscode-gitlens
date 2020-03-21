'use strict';
import {
	DecorationInstanceRenderOptions,
	DecorationOptions,
	ThemableDecorationAttachmentRenderOptions,
	ThemableDecorationRenderOptions,
	ThemeColor,
} from 'vscode';
import { configuration } from '../configuration';
import { GlyphChars } from '../constants';
import { CommitFormatOptions, CommitFormatter, GitCommit } from '../git/gitService';
import { Objects, Strings } from '../system';
import { toRgba } from '../webviews/apps/shared/colors';

export interface ComputedHeatmap {
	cold: boolean;
	colors: { hot: string; cold: string };
	median: number;
	newest: number;
	oldest: number;
	computeAge(date: Date): number;
}

interface HeatmapConfig {
	enabled: boolean;
	location?: 'left' | 'right';
}

interface RenderOptions
	extends DecorationInstanceRenderOptions,
		ThemableDecorationRenderOptions,
		ThemableDecorationAttachmentRenderOptions {
	height?: string;
	uncommittedColor?: string | ThemeColor;
}

const defaultHeatmapHotColor = '#f66a0a';
const defaultHeatmapColdColor = '#0a60f6';

let computedHeatmapColor: {
	color: string;
	rgb: string;
};

export class Annotations {
	static applyHeatmap(decoration: Partial<DecorationOptions>, date: Date, heatmap: ComputedHeatmap) {
		const color = this.getHeatmapColor(date, heatmap);
		decoration.renderOptions!.before!.borderColor = color;
	}

	static gutter(
		commit: GitCommit,
		format: string,
		dateFormatOrFormatOptions: string | null | CommitFormatOptions,
		renderOptions: RenderOptions,
	): Partial<DecorationOptions> {
		const decoration: Partial<DecorationOptions> = {
			renderOptions: {
				before: { ...renderOptions },
			},
		};

		if (commit.isUncommitted) {
			decoration.renderOptions!.before!.color = renderOptions.uncommittedColor;
		}

		const message = CommitFormatter.fromTemplate(format, commit, dateFormatOrFormatOptions);
		decoration.renderOptions!.before!.contentText = Strings.pad(message.replace(/ /g, GlyphChars.Space), 1, 1);

		return decoration;
	}

	static gutterRenderOptions(
		separateLines: boolean,
		heatmap: HeatmapConfig,
		format: string,
		options: CommitFormatOptions,
	): RenderOptions {
		// Get the character count of all the tokens, assuming there there is a cap (bail if not)
		let chars = 0;
		for (const token of Objects.values(options.tokenOptions!)) {
			if (token === undefined) continue;

			// If any token is uncapped, kick out and set no max
			if (token.truncateTo == null) {
				chars = -1;
				break;
			}

			chars += token.truncateTo;
		}

		if (chars >= 0) {
			// Add the chars of the template string (without tokens)
			chars += Strings.getWidth(Strings.interpolate(format, undefined));
			// If we have chars, add a bit of padding
			if (chars > 0) {
				chars += 3;
			}
		}

		let borderStyle = undefined;
		let borderWidth = undefined;
		if (heatmap.enabled) {
			borderStyle = 'solid';
			borderWidth = heatmap.location === 'left' ? '0 0 0 2px' : '0 2px 0 0';
		}

		let width;
		if (chars >= 0) {
			const spacing = configuration.getAny<number>('editor.letterSpacing');
			if (spacing != null && spacing !== 0) {
				width = `calc(${chars}ch + ${Math.round(chars * spacing)}px)`;
			} else {
				width = `${chars}ch`;
			}
		}

		return {
			backgroundColor: new ThemeColor('gitlens.gutterBackgroundColor'),
			borderStyle: borderStyle,
			borderWidth: borderWidth,
			color: new ThemeColor('gitlens.gutterForegroundColor'),
			fontWeight: 'normal',
			fontStyle: 'normal',
			height: '100%',
			margin: '0 26px -1px 0',
			textDecoration: separateLines ? 'overline solid rgba(0, 0, 0, .2)' : 'none',
			width: width,
			uncommittedColor: new ThemeColor('gitlens.gutterUncommittedForegroundColor'),
		};
	}

	static heatmap(
		commit: GitCommit,
		heatmap: ComputedHeatmap,
		renderOptions: RenderOptions,
	): Partial<DecorationOptions> {
		const decoration: Partial<DecorationOptions> = {
			renderOptions: {
				before: { ...renderOptions },
			},
		};

		Annotations.applyHeatmap(decoration, commit.date, heatmap);

		return decoration;
	}

	static heatmapRenderOptions(): RenderOptions {
		return {
			borderStyle: 'solid',
			borderWidth: '0 0 0 2px',
		};
	}

	static trailing(
		commit: GitCommit,
		// uri: GitUri,
		// editorLine: number,
		format: string,
		formatOptions?: CommitFormatOptions,
		scrollable: boolean = true,
	): Partial<DecorationOptions> {
		// TODO: Enable this once there is better caching
		// let diffUris;
		// if (commit.isUncommitted) {
		//     diffUris = await commit.getPreviousLineDiffUris(uri, editorLine, uri.sha);
		// }

		const message = CommitFormatter.fromTemplate(format, commit, {
			...formatOptions,
			// previousLineDiffUris: diffUris,
			truncateMessageAtNewLine: true,
		});

		return {
			renderOptions: {
				after: {
					backgroundColor: new ThemeColor('gitlens.trailingLineBackgroundColor'),
					color: new ThemeColor('gitlens.trailingLineForegroundColor'),
					contentText: Strings.pad(message.replace(/ /g, GlyphChars.Space), 1, 1),
					fontWeight: 'normal',
					fontStyle: 'normal',
					// Pull the decoration out of the document flow if we want to be scrollable
					textDecoration: `none;${scrollable ? '' : ' position: absolute;'}`,
				},
			},
		};
	}

	private static getHeatmapColor(date: Date, heatmap: ComputedHeatmap) {
		const baseColor = heatmap.cold ? heatmap.colors.cold : heatmap.colors.hot;

		const age = heatmap.computeAge(date);
		if (age === 0) return baseColor;

		if (computedHeatmapColor === undefined || computedHeatmapColor.color !== baseColor) {
			let rgba = toRgba(baseColor);
			if (rgba == null) {
				rgba = toRgba(heatmap.cold ? defaultHeatmapColdColor : defaultHeatmapHotColor)!;
			}

			const [r, g, b] = rgba;
			computedHeatmapColor = {
				color: baseColor,
				rgb: `${r}, ${g}, ${b}`,
			};
		}

		return `rgba(${computedHeatmapColor.rgb}, ${(1 - age / 10).toFixed(2)})`;
	}
}
