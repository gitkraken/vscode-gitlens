export function customElementIfFree(name: string): (target: CustomElementConstructor) => void {
	return target => {
		if (customElements.get(name) == null) {
			customElements.define(name, target);
		}
	};
}
