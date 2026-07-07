export interface ComponentDemo {
	label: string;
	render: () => unknown;
	/** Stage layout: inline flex-wrap row (default), full-width block, stacked column, or bounded-height block */
	layout?: 'block' | 'stack' | 'tall';
	/** Span two grid columns while staying an inline stage */
	wide?: boolean;
	/** Caveat/interaction hint rendered under the label */
	note?: string;
}

export interface ComponentGroup {
	family: string;
	/** Optional one-line description rendered under the family title */
	description?: string;
	demos: ComponentDemo[];
}
