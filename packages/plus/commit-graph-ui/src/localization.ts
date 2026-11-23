import type { GraphLocalizer, GraphMessageArgs } from '@gitkraken/commit-graph/l10n.js';
import { formatMessage, setMessageLocalizer } from '@gitkraken/commit-graph/l10n.js';
import { setLanePalette } from '@gitkraken/commit-graph/lanes/colors.js';
import { setDefaultDateLocales } from '@gitlens/utils/date.js';
import { setPluralLocale } from '@gitlens/utils/plural.js';
import { connectedGraphs } from './connectedGraphs.js';

export type { GraphLocalizer, GraphMessage, GraphMessageArgs } from '@gitkraken/commit-graph/l10n.js';

export interface GraphLocalizationOptions {
	/** BCP 47 locale for dates, numbers, plurals and lists; unset follows the browser (dates, numbers) and the
	 *  document's `lang` (plurals, lists). */
	readonly locale?: string;
}

/** Translates every message through `localizer` and formats for `options.locale`; `undefined` restores the defaults.
 *  Every graph redraws. */
export function setGraphLocalizer(localizer: GraphLocalizer | undefined, options?: GraphLocalizationOptions): void {
	setDefaultDateLocales(options?.locale);
	setPluralLocale(options?.locale);
	setMessageLocalizer(localizer);
	for (const graph of connectedGraphs) {
		graph.requestUpdate();
	}
}

/** Substitutes `args` into a translated template as `@vscode/l10n` does; with no args the template is returned as is,
 *  so plural blocks stay for the graph to resolve. */
export function formatGraphMessage(template: string, args: GraphMessageArgs): string {
	return formatMessage(template, args);
}

/** Sets the lane colours of every graph, one per lane, repeating past the last; an entry that isn't a CSS colour leaves
 *  the palette unchanged with a console warning. `undefined` restores the built-in palette. */
export function setGraphLanePalette(colors: readonly string[] | undefined): void {
	let palette: string[] | undefined;
	if (colors != null) {
		palette = [];
		for (const color of colors) {
			const hex = cssColorToHex(color);
			if (hex == null) {
				console.warn(
					`setGraphLanePalette: ${JSON.stringify(color)} is not a CSS color; the palette is unchanged`,
				);
				return;
			}

			palette.push(hex);
		}
	}

	if (setLanePalette(palette)) {
		window.dispatchEvent(new CustomEvent('gl-graph-lane-palette-changed'));
	}
}

let colorContext: CanvasRenderingContext2D | null | undefined;

function cssColorToHex(color: string): string | undefined {
	colorContext ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
	const context = colorContext;
	if (context == null) return undefined;

	context.fillStyle = '#000000';
	context.fillStyle = color;
	const parsed = context.fillStyle;
	context.fillStyle = '#ffffff';
	context.fillStyle = color;
	if (context.fillStyle !== parsed) return undefined;

	context.clearRect(0, 0, 1, 1);
	context.fillRect(0, 0, 1, 1);
	const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
	return `#${[r, g, b].map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
}
