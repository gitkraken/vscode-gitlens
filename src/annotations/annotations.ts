'use strict';
import {
	DecorationInstanceRenderOptions,
	DecorationOptions,
	Range,
	TextEditorDecorationType,
	ThemableDecorationAttachmentRenderOptions,
	ThemableDecorationRenderOptions,
	ThemeColor,
	Uri,
	window,
} from 'vscode';
import { configuration } from '../configuration';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { CommitFormatOptions, CommitFormatter, GitCommit } from '../git/git';
import { Objects, Strings } from '../system';
import { toRgba } from '../webviews/apps/shared/colors';

export interface ComputedHeatmap {
	coldThresholdTimestamp: number;
	colors: { hot: string[]; cold: string[] };
	computeRelativeAge(date: Date): number;
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
const defaultHeatmapColors = [
	'#f66a0a',
	'#ef6939',
	'#e96950',
	'#e26862',
	'#db6871',
	'#d3677e',
	'#cc678a',
	'#c46696',
	'#bb66a0',
	'#b365a9',
	'#a965b3',
	'#a064bb',
	'#9664c4',
	'#8a63cc',
	'#7e63d3',
	'#7162db',
	'#6262e2',
	'#5061e9',
	'#3961ef',
	'#0a60f6',
];

let heatmapColors: { hot: string[]; cold: string[] } | undefined;
export async function getHeatmapColors() {
	if (heatmapColors == null) {
		let colors;
		if (
			Container.config.heatmap.coldColor === defaultHeatmapColdColor &&
			Container.config.heatmap.hotColor === defaultHeatmapHotColor
		) {
			colors = defaultHeatmapColors;
		} else {
			const chroma = await import(/* webpackChunkName: "heatmap-chroma" */ 'chroma-js');
			colors = chroma
				.scale([Container.config.heatmap.hotColor, Container.config.heatmap.coldColor])
				.mode('lrgb')
				.classes(20)
				.colors(20);
		}

		heatmapColors = {
			hot: colors.slice(0, 10),
			cold: colors.slice(10, 20),
		};

		const disposable = configuration.onDidChange(e => {
			if (
				configuration.changed(e, 'heatmap', 'ageThreshold') ||
				configuration.changed(e, 'heatmap', 'hotColor') ||
				configuration.changed(e, 'heatmap', 'coldColor')
			) {
				disposable.dispose();
				heatmapColors = undefined;
			}
		});
	}

	return heatmapColors;
}

export class Annotations {
	static applyHeatmap(decoration: Partial<DecorationOptions>, date: Date, heatmap: ComputedHeatmap) {
		const [r, g, b, a] = this.getHeatmapColor(date, heatmap);
		decoration.renderOptions!.before!.borderColor = `rgba(${r},${g},${b},${a})`;
	}

	static addOrUpdateGutterHeatmapDecoration(
		date: Date,
		heatmap: ComputedHeatmap,
		range: Range,
		map: Map<string, { decorationType: TextEditorDecorationType; rangesOrOptions: Range[] }>,
	) {
		const [r, g, b, a] = this.getHeatmapColor(date, heatmap);

		const key = `${r},${g},${b},${a}`;
		let colorDecoration = map.get(key);
		if (colorDecoration == null) {
			colorDecoration = {
				decorationType: window.createTextEditorDecorationType({
					gutterIconPath: Uri.parse(
						`data:image/svg+xml,${encodeURIComponent(
							`<svg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 18 18'><rect fill='rgb(${r},${g},${b})' fill-opacity='${a}' x='7' y='0' width='2' height='18'/></svg>`,
						)}`,
					),
					gutterIconSize: 'contain',
				}),
				rangesOrOptions: [range],
			};
			map.set(key, colorDecoration);
		} else {
			colorDecoration.rangesOrOptions.push(range);
		}

		return colorDecoration.decorationType;
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
		avatars: boolean,
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
				width = `calc(${chars}ch + ${Math.round(chars * spacing) + (avatars ? 13 : -6)}px)`;
			} else {
				width = `calc(${chars}ch ${avatars ? '+ 13px' : '- 6px'})`;
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
			textDecoration: separateLines
				? `overline solid rgba(0, 0, 0, .2);box-sizing:border-box${avatars ? ';padding: 0 0 0 18px' : ''}`
				: `none;box-sizing:border-box${avatars ? ';padding: 0 0 0 18px' : ''}`,
			width: width,
			uncommittedColor: new ThemeColor('gitlens.gutterUncommittedForegroundColor'),
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
			messageTruncateAtNewLine: true,
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
		const age = heatmap.computeRelativeAge(date);
		const colors = date.getTime() < heatmap.coldThresholdTimestamp ? heatmap.colors.cold : heatmap.colors.hot;

		const color = toRgba(colors[age]);
		const a = color == null ? 0 : age === 0 ? 1 : age <= 5 ? 0.8 : 0.6;

		return [...(color ?? [0, 0, 0]), a];
	}
}
