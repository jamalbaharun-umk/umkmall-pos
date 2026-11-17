import type React from "react";
import {
  NUMBER_STYLE_VAR,
  TYPOGRAPHY_PLATFORMS,
  TYPOGRAPHY_ROWS,
  WEIGHT_LEGEND,
  type TypographyPlatform,
} from "./typography-specimens";

const RAIL = {
  desktop: "Typography ~ Desktop",
  mobile: "Typography ~ Mobile",
} as const;
const PLATFORM_LABELS = { desktop: "Desktop", mobile: "Mobile" } as const;

const cell: React.CSSProperties = {
  font: `var(${NUMBER_STYLE_VAR})`,
  padding: "10px 16px",
  textAlign: "left",
  color: "#03203d",
  borderBottom: "1px solid #e6e9ed",
};

// Sentence case in the section's own ink, matching the Figma page — not the small grey
// uppercase a data table usually gets. On a page whose subject IS the type, a header set in a
// treatment the scale does not contain reads as a fifth style nobody published.
const headerCell: React.CSSProperties = {
  ...cell,
  fontWeight: 500,
};

function TypographySection({ platform }: { platform: TypographyPlatform }) {
  const other = platform === "desktop" ? "mobile" : "desktop";

  return (
    <section
      style={{
        display: "flex",
        border: "1px solid #e6e9ed",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          background: "#000000",
          color: "#ffffff",
          padding: "20px 16px",
          minWidth: 160,
          fontFamily: "system-ui, sans-serif",
          fontSize: 14,
        }}
      >
        <div style={{ opacity: 0.6 }}>Principles</div>
        <div style={{ fontWeight: 600, marginTop: 4 }}>{RAIL[platform]}</div>
      </div>

      {/* The table sizes its own columns and this wrapper scrolls when they no longer fit, so a
          Display specimen at 56px never forces the whole PAGE sideways. A fixed layout with a
          percentage Style column looked tidier but broke the specimen down the middle of the
          word at narrow widths — which defeats the one thing this page exists to show. */}
      <div style={{ flex: 1, minWidth: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          {/* The dark rail beside the table already shows this label, and Figma prints it once —
            so the caption is visually hidden rather than repeated. It stays in the DOM because
            it is the table's accessible name, which is the only thing telling a screen reader
            which platform's numbers it is reading. */}
          <caption className="sr-only">{RAIL[platform]}</caption>
          <thead>
            <tr>
              <th scope="col" style={headerCell}>
                Style
              </th>
              <th scope="col" style={headerCell}>
                Size
              </th>
              <th scope="col" style={headerCell}>
                Leading
              </th>
              <th scope="col" style={headerCell}>
                Tracking
              </th>
              <th scope="col" style={headerCell}>
                {PLATFORM_LABELS[other]}
              </th>
            </tr>
          </thead>
          <tbody>
            {TYPOGRAPHY_ROWS[platform].map((row) => (
              <tr key={row.role}>
                {/* The specimen itself: the role's own Semibold style on this platform. The
                  `font` shorthand does not carry letter-spacing, so it is applied separately —
                  and always from the px-suffixed string, never the token's unitless number. */}
                <th
                  scope="row"
                  data-token={row.styleVar}
                  style={{
                    ...cell,
                    font: `var(${row.styleVar})`,
                    letterSpacing: row.letterSpacingCss,
                    // Never clipped and never broken mid-word: the wrapper above scrolls instead,
                    // so the largest specimen stays whole and legible at any width.
                    whiteSpace: "nowrap",
                  }}
                >
                  {row.label}
                </th>
                <td style={cell}>{row.fontSize}</td>
                <td style={cell}>{row.lineHeight}</td>
                {/* Printed bare, as the Figma page prints it. The value is still the design's
                    percentage rather than the token's resolved px — that is what R5 asks for;
                    the `%` sign was ours, and the reference page does not carry it. */}
                <td style={cell}>{row.trackingPercent}</td>
                <td style={cell}>{row.otherPlatformFontSize}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * Foundation → Typography, replicating Ensyra's own Figma Typography page (node `17:279`):
 * a Style / Size / Leading / Tracking table in two stacked platform sections under a shared
 * Font Weight legend, plus one column Figma does not have — the OTHER platform's size, so the
 * mobile/desktop offset is readable without scrolling between sections.
 *
 * **Why the specimens paint from CSS variables and not from `Text`.** `Text` has no platform prop
 * and now maps each role to its MOBILE utility alone, at every viewport — so it cannot render the
 * Desktop section at all. (Until the `lg:` half was dropped it mapped each role to a responsive
 * PAIR, and the hazard was the mirror image: a `Text`-rendered Mobile section silently showed
 * Desktop sizes above 976px. Either way one of the two sections is unrenderable from `Text`,
 * because two sections share one viewport.) The `--typography-<platform>-<role>-<weight>` vars
 * pin both sections and stay correct whichever way `Text`'s scale goes.
 *
 * **Why this page exists beside `Components/Text`.** That story owns the consumer view — every
 * role at every weight, as callers write it. This is the TOKEN view, and shows what that page
 * cannot: the published numbers, both platforms at once, in the design's own table.
 *
 * **Why this lives beside `Foundation.stories.tsx` rather than in it.** The guard renders this
 * component directly — this package depends on `@storybook/react-vite` only, so `composeStories`
 * would be a new dependency for one assertion. But CSF treats EVERY named export of a stories
 * file as a story, so exporting it from there would both publish a phantom "Typography Page"
 * story and break `Foundation.test.ts`, which maps `story.args.page` over every export. Its own
 * module costs one import and avoids both.
 */
export function TypographyPage() {
  return (
    <div
      style={{ display: "grid", gap: 24, fontFamily: "system-ui, sans-serif" }}
    >
      <div
        style={{
          display: "flex",
          gap: 24,
          alignItems: "baseline",
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 12, color: "#61768c" }}>Font Weight</span>
        {WEIGHT_LEGEND.map(([label, value]) => (
          <span
            key={label}
            style={{ fontSize: 14, fontWeight: value, color: "#03203d" }}
          >
            {label} ({value})
          </span>
        ))}
      </div>

      {TYPOGRAPHY_PLATFORMS.map((platform) => (
        <TypographySection key={platform} platform={platform} />
      ))}
    </div>
  );
}
