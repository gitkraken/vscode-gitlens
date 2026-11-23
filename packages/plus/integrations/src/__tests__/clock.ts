const realNow = Date.now;
let offset = 0;

export function advanceClock(ms: number): void {
	offset += ms;
	Date.now = () => realNow() + offset;
}

export function restoreClock(): void {
	offset = 0;
	Date.now = realNow;
}
