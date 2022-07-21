import type { ComplexAttributeConverter } from 'lit';

export const dateConverter = (locale?: string): ComplexAttributeConverter<Date> => {
	return {
		toAttribute: (date: Date) => {
			return date.toLocaleDateString(locale);
		},
		fromAttribute: (value: string) => {
			return new Date(value);
		},
	};
};
