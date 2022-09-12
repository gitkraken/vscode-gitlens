import type { ValueConverter } from '@microsoft/fast-element';

export const numberConverter: ValueConverter = {
	toView: function (value: number): string {
		return value.toString();
	},
	fromView: function (value: string): number {
		return parseInt(value, 10);
	},
};
