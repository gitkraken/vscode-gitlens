import type {
	DecorationOptions,
	Range,
	TextEditorDecorationType,
	ThemableDecorationAttachmentRenderOptions,
} from 'vscode';
import { OverviewRulerLane, ThemeColor, Uri, window } from 'vscode';
import type { GitCommit } from '@gitlens/git/models/commit.js';
import { scale, toRgba } from '@gitlens/utils/color.js';
import { getWidth, interpolate, pad } from '@gitlens/utils/string.js';
import type { Colors } from '../constants.colors.js';
import type { CommitFormatOptions } from '../git/formatters/commitFormatter.js';
import { CommitFormatter } from '../git/formatters/commitFormatter.js';
import { configuration } from '../system/-webview/configuration.js';
import type { BlameFontOptions } from './gutterBlameAnnotationProvider.js';

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

export interface BlameDecorationOptions {
	avatars: boolean;
	compact: boolean;
	fontFamily?: string;
	fontSize?: number;
	fontStyle?: string;
	fontWeight?: string;
	format: string;
	formatOptions: CommitFormatOptions;
	heatmapEnabled: boolean;
	heatmapLocation?: 'left' | 'right';
	separateLines: boolean;
}

/**
 * Builds a CSS-injection string for use in VS Code's `textDecoration` property.
 *
 * VS Code emits `text-decoration: <value>` in the generated CSS rule, so the
 * first token in our string is consumed as the text-decoration value. We always
 * emit `text-decoration:<td>` first (defaulting to `none`) so that subsequent
 * properties land as independent CSS declarations after the terminating `;`.
 */
export function toCssInjection(styles: Record<string, string | number | undefined | null>): string {
	const td = styles['text-decoration'] ?? 'none';
	return `text-decoration:${td};${Object.entries(styles)
		.filter(([key, value]) => key !== 'text-decoration' && value != null && value !== '')
		.map(([key, value]) => `${key}:${value}`)
		.join(';')};`;
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

interface HeatmapColors {
	hot: string[];
	cold: string[];
}
let heatmapColors: HeatmapColors | undefined;
export function getHeatmapColors(): HeatmapColors {
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

export function applyHeatmap(decoration: Partial<DecorationOptions>, date: Date, heatmap: ComputedHeatmap): void {
	const [r, g, b, a] = getHeatmapColor(date, heatmap);
	decoration.renderOptions!.before!.borderColor = `rgba(${r},${g},${b},${a})`;
}

export function addOrUpdateGutterHeatmapDecoration(
	date: Date,
	heatmap: ComputedHeatmap,
	range: Range,
	map: Map<string, Decoration<Range[]>>,
): TextEditorDecorationType {
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

function computeGutterWidth(
	format: string,
	formatOptions: Pick<CommitFormatOptions, 'tokenOptions'>,
	avatars: boolean,
): string | undefined {
	// Get the character count of all the tokens, assuming there is a cap (bail if not)
	let chars = 0;
	for (const token of Object.values(formatOptions.tokenOptions!)) {
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

	if (chars < 0) return undefined;

	const spacing = configuration.getCore('editor.letterSpacing');
	if (spacing != null && spacing !== 0) {
		return `calc(${chars}ch + ${Math.round(chars * spacing) + (avatars ? 13 : -6)}px)`;
	}
	return `calc(${chars}ch ${avatars ? '+ 13px' : '- 6px'})`;
}

export function getAvatarRenderOptions(url: string): ThemableDecorationAttachmentRenderOptions {
	return {
		contentText: '',
		height: '16px',
		width: '16px',
		textDecoration: toCssInjection({
			position: 'absolute',
			top: '1px',
			left: '5px',
			background: `url(${encodeURI(url)})`,
			'background-size': '16px 16px',
			'border-radius': '50%',
			'margin-left': '0 !important',
		}),
	};
}

/**
 * Builds the `before` decoration attachment options for a blame decoration type.
 * These are line-invariant properties that go on the decoration TYPE, not per-instance.
 *
 * Note: heatmap border styling is injected via `textDecoration` CSS hack because
 * `borderStyle`/`borderWidth` aren't available on `ThemableDecorationAttachmentRenderOptions`.
 */
export function getBlameDecorationBaseOptions(
	options: BlameDecorationOptions,
	separator: boolean,
): ThemableDecorationAttachmentRenderOptions {
	return {
		backgroundColor: new ThemeColor('gitlens.gutterBackgroundColor' satisfies Colors),
		color: new ThemeColor('gitlens.gutterForegroundColor' satisfies Colors),
		fontWeight: options.fontWeight ?? 'normal',
		fontStyle: options.fontStyle ?? 'normal',
		height: '100%',
		margin: '0 26px -1px 0',
		width: computeGutterWidth(options.format, options.formatOptions, options.avatars),
		textDecoration: toCssInjection({
			'text-decoration': separator ? 'overline solid rgba(0, 0, 0, .2)' : undefined,
			'box-sizing': 'border-box',
			padding: options.avatars ? '0 0 0 18px' : undefined,
			'font-family': options.fontFamily,
			'font-size': options.fontSize ? `${options.fontSize}px` : undefined,
			'border-style': options.heatmapEnabled ? 'solid' : undefined,
			'border-width': options.heatmapEnabled
				? options.heatmapLocation === 'left'
					? '0 0 0 2px'
					: '0 2px 0 0'
				: undefined,
			'white-space': 'pre',
			'font-variant-numeric': 'tabular-nums',
		}),
	};
}

/**
 * Returns per-instance render options for a blame decoration.
 * Only includes line-varying properties — base CSS lives on the decoration type.
 */
export function getGutterDecoration(
	commit: GitCommit,
	format: string,
	dateFormatOrFormatOptions: string | null | CommitFormatOptions,
	options?: { separateLines?: boolean },
): Partial<DecorationOptions> {
	const message = CommitFormatter.fromTemplate(format, commit, dateFormatOrFormatOptions);
	const decoration: Partial<DecorationOptions> = { renderOptions: { before: { contentText: pad(message, 1, 1) } } };

	if (commit.isUncommitted) {
		decoration.renderOptions!.before!.color = new ThemeColor(
			'gitlens.gutterUncommittedForegroundColor' satisfies Colors,
		);
	}

	// Apply the separator overline per-instance because VS Code doesn't reliably
	// cascade the type-level textDecoration CSS hack to per-instance sub-types
	if (options?.separateLines) {
		decoration.renderOptions!.before!.textDecoration = 'overline solid rgba(0, 0, 0, .2)';
	}

	return decoration;
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
				contentText: pad(message, 1, 1),
				fontWeight: fontOptions?.weight ?? 'normal',
				fontStyle: fontOptions?.style ?? 'normal',
				// Pull the decoration out of the document flow if we want to be scrollable
				textDecoration: toCssInjection({
					position: scrollable ? undefined : 'absolute',
					'font-family': fontOptions?.family,
					'font-size': fontOptions?.size ? `${fontOptions?.size}px` : undefined,
					'white-space': 'pre',
					'font-variant-numeric': 'tabular-nums',
				}),
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
