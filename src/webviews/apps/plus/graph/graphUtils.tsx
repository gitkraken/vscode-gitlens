import { CssVariables } from '@axosoft/gitkraken-components/lib/components/graph/GraphContainer';

export const calculateCSSVariables = (): CssVariables => {
    const body = document.body;
    const computedStyle = window.getComputedStyle(body);
    return {
        '--app__bg0': computedStyle.getPropertyValue('--color-background'),
        // note that we should probably do something theme-related here, (dark theme we lighten, light theme we darken)
        '--panel__bg0':computedStyle.getPropertyValue('--color-background--lighten-05'),
    };
};
