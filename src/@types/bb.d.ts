export interface ChartWithInternal {
	internal: ChartInternal;
}

export interface ChartInternal {
	showGridFocus(data?: DataItem[]): void;
	hideGridFocus(): void;

	setExpand?(i: number, id: string | null, reset: boolean): void;
	toggleShape?(that: object | null, d: DataItem, i: number): void;
}
