# Webview Accessibility Requirements

When creating or modifying Lit web components:

- **Focus management**: Ensure keyboard navigation works. Tab order must be logical. Custom interactive elements need `tabindex="0"` and keyboard event handlers (Enter/Space for activation).
- **Focus traps**: Modal/overlay components must trap focus inside when open and restore focus on close. Use a tested focus-trap utility rather than implementing from scratch.
- **ARIA attributes**: Interactive elements must have appropriate `role` and `aria-*` attributes. Custom widgets need `aria-expanded`, `aria-selected`, `aria-disabled` as appropriate.
- **Tooltips**: Must appear on both hover AND keyboard focus. Must be dismissible with Escape.
- **Visual indicators**: Focus outlines must be visible. Do NOT use `outline: none` without providing an alternative visible indicator. Avoid double outlines from both `:focus` and `:focus-visible`.
- **Color contrast**: Use VS Code theme CSS custom properties (`--vscode-*`). Do not hardcode colors.
