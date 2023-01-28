import { steps as interpolateSteps } from 'colorjs.io/fn';

const cssColorRegex =
	/^(?:(#?)([0-9a-f]{3}|[0-9a-f]{6})|((?:rgb|hsl)a?)\((-?\d+%?)[,\s]+(-?\d+%?)[,\s]+(-?\d+%?)[,\s]*(-?[\d.]+%?)?\))$/i;

function adjustLight(color: number, amount: number) {
	const cc = color + amount;
	const c = amount < 0 ? (cc < 0 ? 0 : cc) : cc > 255 ? 255 : cc;

	return Math.round(c);
}

export function darken(color: string, percentage: number) {
	return lighten(color, -percentage);
}

export function interpolate(color1: string, color2: string, steps: number): string[] {
	return interpolateSteps(color1, color2, {
		space: 'xyz',
		outputSpace: 'srgb',
		steps: steps,
		maxSteps: steps,
	}).map(c => c.toString({ format: 'hex' }));
}

export function lighten(color: string, percentage: number) {
	const rgba = toRgba(color);
	if (rgba == null) return color;

	const [r, g, b, a] = rgba;
	const amount = (255 * percentage) / 100;
	return `rgba(${adjustLight(r, amount)}, ${adjustLight(g, amount)}, ${adjustLight(b, amount)}, ${a})`;
}

export function opacity(color: string, percentage: number) {
	const rgba = toRgba(color);
	if (rgba == null) return color;

	const [r, g, b, a] = rgba;
	return `rgba(${r}, ${g}, ${b}, ${a * (percentage / 100)})`;
}

export function mix(color1: string, color2: string, percentage: number) {
	const rgba1 = toRgba(color1);
	const rgba2 = toRgba(color2);
	if (rgba1 == null || rgba2 == null) return color1;
	const [r1, g1, b1, a1] = rgba1;
	const [r2, g2, b2, a2] = rgba2;
	return `rgba(${mixChannel(r1, r2, percentage)}, ${mixChannel(g1, g2, percentage)}, ${mixChannel(
		b1,
		b2,
		percentage,
	)}, ${mixChannel(a1, a2, percentage)})`;
}

const mixChannel = (channel1: number, channel2: number, percentage: number) => {
	return channel1 + ((channel2 - channel1) * percentage) / 100;
};

export function toRgba(color: string) {
	color = color.trim();

	const result = cssColorRegex.exec(color);
	if (result == null) return null;

	if (result[1] === '#') {
		const hex = result[2];
		switch (hex.length) {
			case 3:
				return [parseInt(hex[0] + hex[0], 16), parseInt(hex[1] + hex[1], 16), parseInt(hex[2] + hex[2], 16), 1];
			case 6:
				return [
					parseInt(hex.substring(0, 2), 16),
					parseInt(hex.substring(2, 4), 16),
					parseInt(hex.substring(4, 6), 16),
					1,
				];
		}

		return null;
	}

	switch (result[3]) {
		case 'rgb':
			return [parseInt(result[4], 10), parseInt(result[5], 10), parseInt(result[6], 10), 1];
		case 'rgba':
			return [parseInt(result[4], 10), parseInt(result[5], 10), parseInt(result[6], 10), parseFloat(result[7])];
		default:
			return null;
	}
}
