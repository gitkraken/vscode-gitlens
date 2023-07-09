export class MRU<T> {
	private stack: T[] = [];

	constructor(
		public readonly maxSize: number = 10,
		private readonly comparator?: (a: T, b: T) => boolean,
	) {}

	get count(): number {
		return this.stack.length;
	}

	private _position: number = 0;
	get position(): number {
		return this._position;
	}

	add(item: T): void {
		if (this._position > 0) {
			this.stack.splice(0, this._position);
			this._position = 0;
		}

		const index =
			this.comparator != null ? this.stack.findIndex(i => this.comparator!(item, i)) : this.stack.indexOf(item);
		if (index !== -1) {
			this.stack.splice(index, 1);
		} else if (this.stack.length === this.maxSize) {
			this.stack.pop();
		}

		this.stack.unshift(item);
		this._position = 0;
	}

	get(position?: number): T | undefined {
		if (position != null) {
			if (position < 0 || position >= this.stack.length) return undefined;
			return this.stack[position];
		}
		return this.stack.length > 0 ? this.stack[0] : undefined;
	}

	insert(item: T): void {
		if (this._position > 0) {
			this.stack.splice(0, this._position);
			this._position = 0;
		}
		this.stack.unshift(item);
		this._position++;
	}

	navigate(direction: 'back' | 'forward'): T | undefined {
		if (this.stack.length <= 1) return undefined;

		if (direction === 'back') {
			if (this._position >= this.stack.length - 1) return undefined;
			this._position += 1;
		} else {
			if (this._position <= 0) return undefined;
			this._position -= 1;
		}

		return this.stack[this._position];
	}
}
