import type {
	DecorationInstanceRenderOptions,
	DecorationOptions,
	Range,
	TextEditorDecorationType,
	ThemableDecorationAttachmentRenderOptions,
	ThemableDecorationRenderOptions,
} from 'vscode';
import { OverviewRulerLane, ThemeColor, Uri, window } from 'vscode';
import type { Config } from '../config';
import { GlyphChars } from '../constants';
import type { Colors } from '../constants.colors';
import type { CommitFormatOptions } from '../git/formatters/commitFormatter';
import { CommitFormatter } from '../git/formatters/commitFormatter';
import type { GitCommit } from '../git/models/commit';
import { scale, toRgba } from '../system/color';
import { getWidth, interpolate, pad } from '../system/string';
import { configuration } from '../system/vscode/configuration';
import type { BlameFontOptions } from './gutterBlameAnnotationProvider';

export interface ComputedHeatmap {
	coldThresholdTimestamp: number;
	colors: { hot: string[]; cold: string[] };
	computeRelativeAge(date: Date): number;
	computeOpacity(date: Date): number;
}

export type Decoration<T extends Range[] | DecorationOptions[] = Range[] | DecorationOptions[]> = {
	decorationType: TextEditorDecorationType;
	rangesOrOptions: T;
	dispose?: boolean;
};

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
export function getHeatmapColors() {
	if (heatmapColors == null) {
		const { coldColor, hotColor } = configuration.get('heatmap');

		let colors;
		if (coldColor === defaultHeatmapColdColor && hotColor === defaultHeatmapHotColor) {
			colors = defaultHeatmapColors;
		} else {
			colors = scale(hotColor, coldColor, 20);
		}
		heatmapColors = {
			hot: colors.slice(0, 10),
			cold: colors.slice(10, 20),
		};

		const disposable = configuration.onDidChange(e => {
			if (configuration.changed(e, ['heatmap.ageThreshold', 'heatmap.hotColor', 'heatmap.coldColor'])) {
				disposable.dispose();
				heatmapColors = undefined;
			}
		});
	}

	return heatmapColors;
}

export function applyHeatmap(decoration: Partial<DecorationOptions>, date: Date, heatmap: ComputedHeatmap) {
	const [r, g, b, a] = getHeatmapColor(date, heatmap);
	decoration.renderOptions!.before!.borderColor = `rgba(${r},${g},${b},${a})`;
}

export function addOrUpdateGutterHeatmapDecoration(
	date: Date,
	heatmap: ComputedHeatmap,
	range: Range,
	map: Map<string, Decoration<Range[]>>,
) {
	const [r, g, b, a] = getHeatmapColor(date, heatmap);

	const { fadeLines, locations } = configuration.get('heatmap');
	const gutter = locations.includes('gutter');
	const line = locations.includes('line');
	const scrollbar = locations.includes('overview');

	const key = `${r},${g},${b},${a}`;
	let colorDecoration = map.get(key);
	if (colorDecoration == null) {
		colorDecoration = {
			decorationType: window.createTextEditorDecorationType({
				backgroundColor: line ? `rgba(${r},${g},${b},${a * 0.15})` : undefined,
				opacity: fadeLines ? `${heatmap.computeOpacity(date).toFixed(2)} !important` : undefined,
				isWholeLine: line || fadeLines ? true : undefined,
				gutterIconPath: gutter
					? Uri.parse(
							`data:image/svg+xml,${encodeURIComponent(
								`<svg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 18 18'><rect fill='rgb(${r},${g},${b})' fill-opacity='${a}' x='8' y='0' width='3' height='18'/></svg>`,
							)}`,
					  )
					: undefined,
				gutterIconSize: gutter ? 'contain' : undefined,
				overviewRulerLane: scrollbar ? OverviewRulerLane.Center : undefined,
				overviewRulerColor: scrollbar ? `rgba(${r},${g},${b},${a * 0.7})` : undefined,
			}),
			rangesOrOptions: [range],
			dispose: true,
		};
		map.set(key, colorDecoration);
	} else {
		colorDecoration.rangesOrOptions.push(range);
	}

	return colorDecoration.decorationType;
}

export function getGutterDecoration(
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
	decoration.renderOptions!.before!.contentText = pad(message.replace(/ /g, GlyphChars.Space), 1, 1);

	return decoration;
}

export function getGutterRenderOptions(
	separateLines: boolean,
	heatmap: Config['blame']['heatmap'],
	avatars: boolean,
	format: string,
	options: CommitFormatOptions,
	fontOptions: BlameFontOptions,
): RenderOptions {
	// Get the character count of all the tokens, assuming there there is a cap (bail if not)
	let chars = 0;
	for (const token of Object.values(options.tokenOptions!)) {
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
		chars += getWidth(interpolate(format, undefined));
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
		const spacing = configuration.getCore('editor.letterSpacing');
		if (spacing != null && spacing !== 0) {
			width = `calc(${chars}ch + ${Math.round(chars * spacing) + (avatars ? 13 : -6)}px)`;
		} else {
			width = `calc(${chars}ch ${avatars ? '+ 13px' : '- 6px'})`;
		}
	}

	return {
		backgroundColor: new ThemeColor('gitlens.gutterBackgroundColor' satisfies Colors),
		borderStyle: borderStyle,
		borderWidth: borderWidth,
		color: new ThemeColor('gitlens.gutterForegroundColor' satisfies Colors),
		fontWeight: fontOptions.weight ?? 'normal',
		fontStyle: fontOptions.style ?? 'normal',
		height: '100%',
		margin: '0 26px -1px 0',
		textDecoration: `${separateLines ? 'overline solid rgba(0, 0, 0, .2)' : 'none'};box-sizing: border-box${
			avatars ? ';padding: 0 0 0 18px' : ''
		}${fontOptions.family ? `;font-family: ${fontOptions.family}` : ''}${
			fontOptions.size ? `;font-size: ${fontOptions.size}px` : ''
		};`,
		width: width,
		uncommittedColor: new ThemeColor('gitlens.gutterUncommittedForegroundColor' satisfies Colors),
	};
}

export function getInlineDecoration(
	commit: GitCommit,
	// uri: GitUri,
	// editorLine: number,
	format: string,
	formatOptions?: CommitFormatOptions,
	fontOptions?: BlameFontOptions,
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
				backgroundColor: new ThemeColor('gitlens.trailingLineBackgroundColor' satisfies Colors),
				color: new ThemeColor('gitlens.trailingLineForegroundColor' satisfies Colors),
				contentText: pad(message.replace(/ /g, GlyphChars.Space), 1, 1),
				fontWeight: fontOptions?.weight ?? 'normal',
				fontStyle: fontOptions?.style ?? 'normal',
				// Pull the decoration out of the document flow if we want to be scrollable
				textDecoration: `none${scrollable ? '' : ';position: absolute'}${
					fontOptions?.family ? `;font-family: ${fontOptions.family}` : ''
				}${fontOptions?.size ? `;font-size: ${fontOptions.size}px` : ''};`,
			},
		},
	};
}

function getHeatmapColor(date: Date, heatmap: ComputedHeatmap) {
	const age = heatmap.computeRelativeAge(date);
	const colors = date.getTime() < heatmap.coldThresholdTimestamp ? heatmap.colors.cold : heatmap.colors.hot;

	const color = toRgba(colors[age]);
	const a = color == null ? 0 : age === 0 ? 1 : age <= 5 ? 0.8 : 0.6;

	return [...(color ?? [0, 0, 0]), a];
}
