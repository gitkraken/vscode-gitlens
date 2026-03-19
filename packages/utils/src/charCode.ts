export const CharCode = {
	/**
	 * The `#` character.
	 */
	Hash: 35,
	/**
	 * The `/` character.
	 */
	Slash: 47,
	Digit0: 48,
	Digit1: 49,
	Digit2: 50,
	Digit3: 51,
	Digit4: 52,
	Digit5: 53,
	Digit6: 54,
	Digit7: 55,
	Digit8: 56,
	Digit9: 57,
	/**
	 * The `\` character.
	 */
	Backslash: 92,
	A: 65,
	B: 66,
	C: 67,
	D: 68,
	E: 69,
	F: 70,
	Z: 90,
	a: 97,
	b: 98,
	c: 99,
	d: 100,
	e: 101,
	f: 102,
	z: 122,
} as const satisfies Record<string, number>;
