## File Annotations

<p align="center">
  <img src="../../images/docs/gutter-toggle.png" alt="Toggle File Annotations" />
</p>

GitLens adds on-demand annotations for the whole file directly to the editor's scroll bar and in the gutter area, the space beside the line number, to help you gain more insights into your code.

### File Blame

<p align="center">
  <img src="../../images/docs/gutter-blame.png" alt="Gutter Blame" />
</p>

When activated, GitLens expands the gutter area to show the commit and author for each line of the file, similar to the current line blame. On the right edge of the gutter, an age indicator (heatmap) is shown to provide an easy, at-a-glance way to tell how recently lines were changed (see the Heatmap below for more details). An additional indicator, which highlights other lines that were also changed as part of the current line's commit, is shown both the far left edge and on the scrollbar.

💡 On an active file, use the [Toggle File Blame](command:workbench.action.quickOpen?%22>GitLens%3A%20Toggle%20File%20Blame%22) command from the Command Palette to turn the annotation on and off.

⚙️ Use the settings editor to customize the [file blame](command:gitlens.showSettingsPage?%22blame%22 'Jump to the Gutter Blame settings').

### File Changes

<p align="center">
  <img src="../../images/docs/gutter-changes.png" alt="Gutter Changes" />
</p>

When activated, indicators are shown on the left edge of the gutter to highlight any local, unpublished, changes or lines changed by the most recent commit.

💡 On an active file, use the [Toggle File Changes](command:workbench.action.quickOpen?%22>GitLens%3A%20Toggle%20File%20Changes%22) command from the Command Palette to turn the annotation on and off.

⚙️ Use the settings editor to customize the [file changes](command:gitlens.showSettingsPage?%22changes%22 'Jump to the Gutter Changes settings').

### Heatmap

<p align="center">
  <img src="../../images/docs/gutter-heatmap.png" alt="Gutter Heatmap" />
</p>

When activated, a color-coded indicator line is shown on the left edge of the gutter to show how recently lines were changed relative to all the other changes in the file. The colors range from hot, orange, to cold, blue, based on the age of the most recent change. Changes are considered cold after 90 days.

💡 On an active file, use the [Toggle File Heatmap](command:workbench.action.quickOpen?%22>GitLens%3A%20Toggle%20File%20Heatmap%22) command from the Command Palette to turn the annotation on and off.

⚙️ Use the settings editor to customize the [file heatmap](command:gitlens.showSettingsPage?%22heatmap%22 'Jump to the Gutter Heatmap settings').
