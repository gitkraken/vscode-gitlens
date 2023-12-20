import type { CSSResult } from 'lit';

export function litToStyleSheet(...cssResults: CSSResult[]): CSSStyleSheet[] {
	return cssResults.map(r => r.styleSheet).filter(s => s != null) as CSSStyleSheet[];
}
