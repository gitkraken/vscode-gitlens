import { noChange } from 'lit';
import type { AttributePart, DirectiveParameters, PartInfo } from 'lit/directive.js';
import { Directive, directive, PartType } from 'lit/directive.js';

export interface StyleInfo {
	[name: string]: string | number | undefined | null;
}

const important = 'important';
// The leading space is important
const importantFlag = ` !${important}`;
// How many characters to remove from a value, as a negative number
const flagTrim = 0 - importantFlag.length;

/**
 * Drop-in CSP-safe alternative to Lit's `styleMap`.
 *
 * Behaves identically to `styleMap` except it never writes the `style="..."`
 * attribute — all properties are applied via CSSOM. The webview CSP blocks
 * inline style attribute writes (no `'unsafe-inline'` for `style-src`), which
 * `styleMap` does on its first update.
 *
 * Use it the same way as `styleMap`:
 *   html`<div style=${cspStyleMap({ top: `${y}px`, '--accent': color })}></div>`
 *
 * Property name conventions match `styleMap`: kebab-case (`background-color`,
 * `--my-var`) goes through `setProperty`; camelCase (`backgroundColor`) goes
 * through bracket assignment. `null`/`undefined` values remove the declaration.
 * A `' !important'` suffix on a string value is honored via the third arg to
 * `setProperty`.
 */
class CspStyleMapDirective extends Directive {
	// Stores `key -> last-applied stringified value` so we can skip CSSOM writes
	// when a property's value hasn't changed since the previous update.
	private _previous?: Map<string, string>;

	constructor(partInfo: PartInfo) {
		super(partInfo);
		if (
			partInfo.type !== PartType.ATTRIBUTE ||
			partInfo.name !== 'style' ||
			(partInfo.strings?.length as number) > 2
		) {
			throw new Error(
				'The `cspStyleMap` directive must be used in the `style` attribute and must be the only part in the attribute.',
			);
		}
	}

	render(_styleInfo: Readonly<StyleInfo>): typeof noChange {
		return noChange;
	}

	override update(part: AttributePart, [styleInfo]: DirectiveParameters<this>): typeof noChange {
		const style = (part.element as HTMLElement | SVGElement).style;
		const previous = (this._previous ??= new Map());

		// Remove old properties that no longer exist in styleInfo
		for (const name of previous.keys()) {
			if (styleInfo[name] == null) {
				previous.delete(name);
				if (name.includes('-')) {
					style.removeProperty(name);
				} else {
					(style as unknown as Record<string, unknown>)[name] = null;
				}
			}
		}

		// Add or update properties — skip CSSOM call when value is unchanged
		for (const name in styleInfo) {
			const value = styleInfo[name];
			if (value == null) continue;

			const isImportant = typeof value === 'string' && value.endsWith(importantFlag);
			const applied = isImportant ? value.slice(0, flagTrim) : String(value);

			if (previous.get(name) === applied) continue;

			previous.set(name, applied);

			if (name.includes('-') || isImportant) {
				style.setProperty(name, applied, isImportant ? important : '');
			} else {
				(style as unknown as Record<string, unknown>)[name] = applied;
			}
		}
		return noChange;
	}
}

export const cspStyleMap = directive(CspStyleMapDirective);
