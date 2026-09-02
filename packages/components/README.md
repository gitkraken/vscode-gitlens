# `@gitlens/components`

Reusable Lit controllers, custom elements, CSP-safe directives, and styles shared by GitLens webviews and the
commit-graph renderer. Generic utilities live in `@gitlens/utils`; this package stays focused on UI components.

Import explicit subpaths. Utility and type imports have no registration side effects. Importing a component module
registers only that component and its direct custom-element dependencies.

```ts
import { cspStyleMap } from '@gitlens/components/cspStyleMap.directive.js';
import { GlElement } from '@gitlens/components/components/element.js';
import { ModifierKeysController } from '@gitlens/components/controllers/modifierKeys.js';
import '@gitlens/components/components/codeIcon.js';
import '@gitlens/components/components/overlays/popover.js';
import '@gitlens/components/components/overlays/tooltip.js';
```

The package also exposes commit stats, agent marks, tracking pills, roving tabindex, overlay utilities, and
reusable Lit style fragments through the `exports` map in `package.json`.

`code-icon` maps Codicon and GitKraken icon names to glyphs but does not embed font files. The product shell must
provide `codicon` and `glicons` font faces using its own asset URLs and content-security policy.

This package resolves to source (`./src/*.ts`) for every workspace consumer, including GitLens itself. External
products (such as the published `@gitkraken/commit-graph-ui` package) inline it at their own build time via tsdown,
with `lit` as a peer dependency.

Primitive styles consume host-neutral `--color-*`, `--font-*`, and `--gl-*` custom properties with safe fallbacks.
They do not reference VS Code theme variables; hosts map their own theme onto the semantic properties once at the
document boundary.

Browser-safe generic helpers such as date formatting, debouncing, LRU maps, DOM events, and keyboard dispatch are
canonical in the publishable `@gitlens/utils` package. Consumers import those modules directly.

## License

MIT; see `LICENSE`.
