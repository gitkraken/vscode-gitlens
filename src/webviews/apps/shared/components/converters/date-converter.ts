import type { ComplexAttributeConverter } from 'lit';

export const dateConverter = (): ComplexAttributeConverter<Date, number> => {
	return {
		toAttribute: (date: Date) => {
			return date.getTime();
		},
		fromAttribute: (value: string, _type?: number) => {
			return new Date(parseInt(value, 10));
		},
	};
};
