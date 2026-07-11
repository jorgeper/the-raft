# Creating Numshub overlay themes

A theme is **one `.css` file**. Drop it in the themes folder, hit *Reload
themes* in Settings → Appearance, and it shows up in the picker. That's the
whole workflow.

**Where the themes folder is**

- macOS: `~/Library/Application Support/com.numshub.app/themes/`
- Windows: `%APPDATA%\com.numshub.app\themes\`

Numshub creates this folder (and a copy of this guide) on first run.

## The built-in catalog

Indigo (default), Phosphor (CRT green), Amber Terminal, Vaporwave, Nord,
Dracula, Solarized Dark, Solarized Light, Rosé Pine, Catppuccin Mocha,
Newsprint (light, serif), High Contrast.

## Anatomy of a theme

```css
/* @name: Midnight Ocean
   @author: you
   @variant: dark */

.nh-theme {
  /* Pill chrome */
  --nh-pill-bg: rgba(11, 22, 34, 0.92);
  --nh-pill-border: rgba(74, 168, 255, 0.25);

  /* Live transcription text (font included — themes own typography) */
  --nh-text: #d8e2ec;
  --nh-tentative-opacity: 0.55;
  --nh-placeholder: rgba(216, 226, 236, 0.45);
  --nh-font: -apple-system, BlinkMacSystemFont, system-ui, sans-serif;

  /* Timer and recording dot */
  --nh-timer: rgba(216, 226, 236, 0.7);
  --nh-rec-dot: #ff5c77;

  /* Effect colors — every visualizer draws with exactly these three */
  --nh-fx-primary: #4aa8ff;
  --nh-fx-accent: #9fd0ff;
  --nh-fx-glow: rgba(74, 168, 255, 0.8);
}
```

- The **first comment block** carries metadata. `@name` is what the picker
  shows; `@variant` is `light` or `dark`; `@author` is for humans. All three
  are optional — missing metadata falls back to the filename.
- All eleven variables above are the **contract** — define every one. The
  picker marks incomplete themes and Numshub falls back to defaults for
  missing values.
- You may add extra CSS below the variables, scoped under `.nh-theme`, for
  flourishes the variables can't express (e.g. a different pill shadow).
- **No remote resources.** Numshub never touches the network, and themes
  don't get to change that: any `url(http…)` reference makes the theme show
  up disabled with the reason. System font stacks only.
- Files are capped at 64 KB.

## Tips

- Effects express loudness through opacity and glow, so pick an
  `--nh-fx-glow` with alpha (e.g. `rgba(...)`) — solid glows look harsh.
- Test with the settings preview: it runs the real effect engine on fake
  voice levels, so what you see is exactly what recording looks like.
