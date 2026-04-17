/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"],
      },
      colors: {
        // Semantic tokens driven by CSS variables in styles.css. Use these
        // (bg-bg, text-text, text-dim, etc.) instead of `neutral-*` so the
        // same components render correctly in both light and dark mode.
        bg: "rgb(var(--bg) / <alpha-value>)",
        "bg-elev": "rgb(var(--bg-elev) / <alpha-value>)",
        "bg-sunk": "rgb(var(--bg-sunk) / <alpha-value>)",
        "bg-hover": "rgb(var(--bg-hover) / <alpha-value>)",
        text: "rgb(var(--text) / <alpha-value>)",
        dim: "rgb(var(--text-dim) / <alpha-value>)",
        faint: "rgb(var(--text-faint) / <alpha-value>)",
        border: "rgb(var(--border) / <alpha-value>)",
        "border-strong": "rgb(var(--border-strong) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        "accent-text": "rgb(var(--accent-text) / <alpha-value>)",
      },
    },
  },
  plugins: [],
};
