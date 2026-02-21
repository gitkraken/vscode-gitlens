---
name: add-icon
description: Add new icons to the GitLens GL Icons font
---

# /add-icon - Add GL Icon

## Usage

```
/add-icon [icon-name]
```

- `icon-name` — kebab-case (e.g., `my-new-icon`)

## Workflow

### 1. Add SVG File

Place in `images/icons/{icon-name}.svg`

Requirements:

- Square viewBox (e.g., `viewBox="0 0 16 16"`)
- Single color (fill controlled by CSS)
- No embedded `<style>` tags or fonts
- Use `fill="currentColor"` for color inheritance

### 2. Update Mapping

Append to `images/icons/template/mapping.json`:

```json
"icon-name": {next-available-code-point}
```

Code points are in the Private Use Area range (57344-63743). Check existing entries for next available.

### 3. Build

```bash
pnpm run icons:svgo        # Optimize SVGs
pnpm run build:icons       # Generate font (runs svgo + fantasticon + apply + export)
```

### 4. Update Font References

Copy the new `glicons.woff2?{hash}` URL from `src/webviews/apps/shared/glicons.scss` and search-replace the old URL across the codebase.

### 5. Use the Icon

In Lit components:

```typescript
import { glIcon } from '../shared/components/icons.js';
html`${glIcon('my-new-icon')}`;
```

In CSS:

```css
.my-element::before {
	font-family: 'glicons';
	content: '\{codepoint}';
}
```

## Troubleshooting

- **Icon not showing**: Check font URL is updated, verify code point in mapping.json, rebuild with `pnpm run build:icons`
- **SVG issues**: Ensure single path/shape, remove `<style>` tags, use `fill="currentColor"`
