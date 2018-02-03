const cssColorRegEx = /^(?:(#?)([0-9a-f]{3}|[0-9a-f]{6})|((?:rgb|hsl)a?)\((-?\d+%?)[,\s]+(-?\d+%?)[,\s]+(-?\d+%?)[,\s]*(-?[\d\.]+%?)?\))$/i;

function adjustLight(color: number, amount: number) {
    const cc = color + amount;
    const c = amount < 0
        ? cc < 0 ? 0 : cc
        : cc > 255 ? 255 : cc;

    const hex = Math.round(c).toString(16);
    return hex.length > 1 ? hex : `0${hex}`;
}

export function darken(color: string, percentage: number) {
    return lighten(color, -percentage);
}

export function lighten(color: string, percentage: number) {
    const rgb = toRgb(color);
    if (rgb == null) return color;

    const [r, g, b] = rgb;
    percentage = (255 * percentage) / 100;
    return `#${adjustLight(r, percentage)}${adjustLight(g, percentage)}${adjustLight(b, percentage)}`;
}

export function initializeColorPalette() {
    const onColorThemeChanged = () => {
        const body = document.body;
        const computedStyle = getComputedStyle(body);

        const bodyStyle = body.style;
        let color = computedStyle.getPropertyValue('--color').trim();
        const rgb = toRgb(color);
        if (rgb != null) {
            const [r, g, b] = rgb;
            bodyStyle.setProperty('--color--75', `rgba(${r}, ${g}, ${b}, 0.75)`);
            bodyStyle.setProperty('--color--50', `rgba(${r}, ${g}, ${b}, 0.5)`);
        }

        color = computedStyle.getPropertyValue('--background-color').trim();
        bodyStyle.setProperty('--background-color--lighten-05', lighten(color, 5));
        bodyStyle.setProperty('--background-color--darken-05', darken(color, 5));
        bodyStyle.setProperty('--background-color--lighten-075', lighten(color, 7.5));
        bodyStyle.setProperty('--background-color--darken-075', darken(color, 7.5));
        bodyStyle.setProperty('--background-color--lighten-15', lighten(color, 15));
        bodyStyle.setProperty('--background-color--darken-15', darken(color, 15));
        bodyStyle.setProperty('--background-color--lighten-30', lighten(color, 30));
        bodyStyle.setProperty('--background-color--darken-30', darken(color, 30));
    };

    const observer = new MutationObserver(onColorThemeChanged);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    onColorThemeChanged();
    return observer;
}

export function toRgb(color: string) {
    color = color.trim();

    const result = cssColorRegEx.exec(color);
    if (result == null) return null;

    if (result[1] === '#') {
        const hex = result[2];
        switch (hex.length) {
            case 3:
                return [
                    parseInt(hex[0] + hex[0], 16),
                    parseInt(hex[1] + hex[1], 16),
                    parseInt(hex[2] + hex[2], 16)
                ];
            case 6:
                return [
                    parseInt(hex.substring(0, 2), 16),
                    parseInt(hex.substring(2, 4), 16),
                    parseInt(hex.substring(4, 6), 16)
                ];
        }

        return null;
    }

    switch (result[3]) {
        case 'rgb':
        case 'rgba':
            return [
                parseInt(result[4], 10),
                parseInt(result[5], 10),
                parseInt(result[6], 10)
            ];
        default:
            return null;
    }
}