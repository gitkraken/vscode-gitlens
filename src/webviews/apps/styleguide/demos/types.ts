export interface ComponentDemo {
	label: string;
	render: () => unknown;
	/** Stage layout: inline flex-wrap row (default), full-width block, responsive card grid (3-up → 2-up), or bounded-height block */
	layout?: 'block' | 'grid' | 'tall';
	/** Span two grid columns while staying an inline stage */
	wide?: boolean;
	/** Column width for block/tall demos in the responsive demo grid: 'third' = 3-up → 2-up → 1-up, 'half' = 2-up → 1-up (default full width) */
	span?: 'third' | 'half';
	/** Wrap the stage in a visible border frame so bounded/filling demos are easier to see */
	framed?: boolean;
	/** Caveat/interaction hint rendered under the label */
	note?: string;
}

export interface ComponentGroup {
	family: string;
	/** Optional one-line description rendered under the family title */
	description?: string;
	demos: ComponentDemo[];
}
