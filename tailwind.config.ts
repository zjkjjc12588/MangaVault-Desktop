import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        panel: "hsl(var(--panel))",
        panelMuted: "hsl(var(--panel-muted))",
        border: "hsl(var(--border))",
        accent: "hsl(var(--accent))",
        accentText: "hsl(var(--accent-text))",
        danger: "hsl(var(--danger))",
      },
      boxShadow: {
        focus: "0 0 0 3px hsl(var(--accent) / 0.25)",
      },
    },
  },
  plugins: [],
} satisfies Config;
