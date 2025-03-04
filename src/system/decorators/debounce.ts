import { debounce as debounceFunction } from '../function/debounce';

export function debounce<T extends (...args: any[]) => ReturnType<T>>(delay: number) {
	return (_target: any, _fieldName: string, targetFields: { value?: T }): any => {
		// console.log('debounced', targetFields, _fieldName);
		if (!targetFields.value) {
			throw new Error('@debounced can only be used on methods');
		}
		const debounced = debounceFunction(targetFields.value, delay);
		return {
			...targetFields,
			// @ts-expect-error Deferrable<T> to T is safe
			value: debounced as T,
		};
	};
}
