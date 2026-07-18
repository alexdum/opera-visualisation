/**
 * chartExport.ts — Export any dashboard chart card as a branded PNG image.
 *
 * Works with both Recharts-generated SVGs and hand-crafted SVGs (e.g. WindRose).
 * Uses only native browser APIs (no external dependencies).
 */

/** CSS properties that must be inlined for SVG serialization to look correct */
const INLINE_STYLE_PROPS: (keyof CSSStyleDeclaration)[] = [
  "fill",
  "stroke",
  "strokeWidth",
  "strokeDasharray",
  "strokeOpacity",
  "strokeLinecap",
  "strokeLinejoin",
  "fillOpacity",
  "opacity",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "textAnchor",
  "dominantBaseline",
  "color",
  "letterSpacing",
  "textDecoration",
  "visibility",
  "display",
  "clipPath",
  "filter",
  "transform",
];

/** Selectors for interactive Recharts chrome to strip from the export */
const STRIP_SELECTORS = [
  ".recharts-tooltip-wrapper",
  ".recharts-active-dot",
  ".recharts-tooltip-cursor",
  "[class*='recharts-tooltip']",
];

/** Sanitize a string for use in a filename */
function toKebab(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Recursively inline computed CSS styles onto every element in the SVG clone */
function inlineStyles(original: Element, clone: Element): void {
  if (!(original instanceof HTMLElement || original instanceof SVGElement)) return;
  if (!(clone instanceof HTMLElement || clone instanceof SVGElement)) return;

  const computed = window.getComputedStyle(original);
  for (const prop of INLINE_STYLE_PROPS) {
    const value = computed[prop];
    if (value && value !== "" && value !== "normal" && value !== "auto" && (value !== "none" || prop === "display")) {
      (clone as HTMLElement | SVGElement).style.setProperty(prop as string, value as string);
    }
  }

  const origChildren = original.children;
  const cloneChildren = clone.children;
  const len = Math.min(origChildren.length, cloneChildren.length);
  for (let i = 0; i < len; i++) {
    inlineStyles(origChildren[i], cloneChildren[i]);
  }
}

export interface ChartExportOptions {
  title: string;
  stationName?: string;
  country?: string;
}

/**
 * Export a chart container element as a high-DPI PNG with a branded footer.
 *
 * @param containerEl — the outer card `<div>` wrapping the chart SVG
 * @param options     — title, station name, and country for the footer & filename
 */
export async function exportChartAsPng(
  containerEl: HTMLElement,
  options: ChartExportOptions
): Promise<void> {
  try {
    // Find the chart SVG — prefer Recharts surface, then fall back to the
    // largest SVG that is NOT inside a button (avoids grabbing icon SVGs).
    let svgOriginal: SVGSVGElement | null =
      containerEl.querySelector("svg.recharts-surface");

    if (!svgOriginal) {
      // Fallback for hand-crafted SVGs (e.g. WindRose): pick the largest SVG
      // that is not a child of a <button> element.
      const allSvgs = containerEl.querySelectorAll("svg");
      let best: SVGSVGElement | null = null;
      let bestArea = 0;
      allSvgs.forEach((svg) => {
        if (svg.closest("button")) return; // skip icon SVGs inside buttons
        const w = svg.clientWidth || svg.width?.baseVal?.value || 0;
        const h = svg.clientHeight || svg.height?.baseVal?.value || 0;
        const area = w * h;
        if (area > bestArea) {
          bestArea = area;
          best = svg;
        }
      });
      svgOriginal = best;
    }

    if (!svgOriginal) return;

    // Clone to avoid mutating the live DOM
    const svgClone = svgOriginal.cloneNode(true) as SVGSVGElement;

    // Strip interactive Recharts chrome from the clone
    for (const sel of STRIP_SELECTORS) {
      svgClone.querySelectorAll(sel).forEach((el) => el.remove());
    }

    // Inline all computed styles so Tailwind classes survive serialization
    inlineStyles(svgOriginal, svgClone);

    // Read the original viewBox (or fall back to width/height attributes)
    const vb = svgOriginal.viewBox?.baseVal;
    let origW = vb && vb.width > 0 ? vb.width : svgOriginal.width.baseVal.value || svgOriginal.clientWidth || 600;
    const origH = vb && vb.height > 0 ? vb.height : svgOriginal.height.baseVal.value || svgOriginal.clientHeight || 300;

    // For non-Recharts SVGs (e.g. WindRose), check if the container has an
    // HTML legend panel that needs to be drawn into the exported SVG.
    const isRecharts = svgOriginal.classList.contains("recharts-surface");
    if (!isRecharts) {
      // Wind Rose legend: defined as colored squares with labels
      const WIND_LEGEND = [
        { label: "Calm / No Wind (< 1 m/s)", color: "#34d399" },     // emerald-400
        { label: "Breezy / Light (1 - 5 m/s)", color: "#fbbf24" },   // amber-400
        { label: "Windy (5 - 10 m/s)", color: "#fb923c" },           // orange-400
        { label: "Very Windy / Strong (10 - 15 m/s)", color: "#fb7185" }, // rose-400
        { label: "Storm / Dangerous (> 15 m/s)", color: "#d946ef" },  // fuchsia-500
      ];

      // Widen the SVG to fit the legend on the right
      const legendX = origW + 20;
      const legendW = 200;
      origW = origW + legendW + 30;

      // Update clone dimensions to include legend space
      svgClone.setAttribute("viewBox", `${vb ? vb.x : 0} ${vb ? vb.y : 0} ${origW} ${origH}`);
      svgClone.setAttribute("width", String(origW));
      svgClone.setAttribute("height", String(origH));

      // Draw legend title
      const legendTitle = document.createElementNS("http://www.w3.org/2000/svg", "text");
      legendTitle.setAttribute("x", String(legendX));
      legendTitle.setAttribute("y", "100");
      legendTitle.setAttribute("font-family", "Inter, system-ui, -apple-system, sans-serif");
      legendTitle.setAttribute("font-size", "10");
      legendTitle.setAttribute("font-weight", "700");
      legendTitle.setAttribute("fill", "#94a3b8"); // slate-400
      legendTitle.setAttribute("letter-spacing", "0.05em");
      legendTitle.textContent = "WIND SPEED CLASS";
      svgClone.appendChild(legendTitle);

      // Draw each legend item (colored square + label)
      WIND_LEGEND.forEach((item, i) => {
        const y = 120 + i * 22;

        // Colored square
        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("x", String(legendX));
        rect.setAttribute("y", String(y));
        rect.setAttribute("width", "12");
        rect.setAttribute("height", "12");
        rect.setAttribute("rx", "2");
        rect.setAttribute("fill", item.color);
        svgClone.appendChild(rect);

        // Label text
        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", String(legendX + 18));
        text.setAttribute("y", String(y + 10));
        text.setAttribute("font-family", "Inter, system-ui, -apple-system, sans-serif");
        text.setAttribute("font-size", "11");
        text.setAttribute("font-weight", "500");
        text.setAttribute("fill", "#475569"); // slate-600
        text.textContent = item.label;
        svgClone.appendChild(text);
      });
    }

    // Footer dimensions
    const footerHeight = 36;
    const newH = origH + footerHeight;

    // Update the clone's viewBox to accommodate the footer
    svgClone.setAttribute("viewBox", `${vb ? vb.x : 0} ${vb ? vb.y : 0} ${origW} ${newH}`);
    svgClone.setAttribute("width", String(origW));
    svgClone.setAttribute("height", String(newH));

    // -- Footer background rect --
    const footerRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    footerRect.setAttribute("x", String(vb ? vb.x : 0));
    footerRect.setAttribute("y", String(origH));
    footerRect.setAttribute("width", String(origW));
    footerRect.setAttribute("height", String(footerHeight));
    footerRect.setAttribute("fill", "#f1f5f9");
    svgClone.appendChild(footerRect);

    // -- Footer text --
    const footerText = document.createElementNS("http://www.w3.org/2000/svg", "text");
    const textX = (vb ? vb.x : 0) + origW / 2;
    const textY = origH + footerHeight / 2 + 4;
    footerText.setAttribute("x", String(textX));
    footerText.setAttribute("y", String(textY));
    footerText.setAttribute("text-anchor", "middle");
    footerText.setAttribute("font-family", "Inter, system-ui, -apple-system, sans-serif");
    footerText.setAttribute("font-size", "11");
    footerText.setAttribute("fill", "#64748b"); // slate-500

    // Build footer content with graceful degradation
    const parts: string[] = [];
    if (options.stationName) {
      parts.push(options.stationName);
    }
    if (options.country) {
      parts.push(options.country);
    }
    const locationStr = parts.join(", ");
    const footerContent = locationStr
      ? `${locationStr}  ·  climateexplorer.app`
      : "climateexplorer.app";

    footerText.textContent = footerContent;
    svgClone.appendChild(footerText);

    // Serialize the SVG clone to a data URL
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svgClone);
    const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    const svgUrl = URL.createObjectURL(svgBlob);

    // Render to canvas at 2× pixel ratio for Retina sharpness
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = origW * scale;
    canvas.height = newH * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Fill with white background so transparent areas render cleanly
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const img = new Image();
    img.crossOrigin = "anonymous";

    await new Promise<void>((resolve, reject) => {
      img.onload = () => {
        ctx.drawImage(img, 0, 0, origW * scale, newH * scale);
        URL.revokeObjectURL(svgUrl);
        resolve();
      };
      img.onerror = () => {
        URL.revokeObjectURL(svgUrl);
        reject(new Error("Image load failed"));
      };
      img.src = svgUrl;
    });

    // Trigger the download via Blob for lower memory pressure
    const stationSlug = options.stationName ? `_${toKebab(options.stationName)}` : "";
    const filename = `${toKebab(options.title)}${stationSlug}.png`;

    await new Promise<void>((resolve) => {
      canvas.toBlob((blob) => {
        if (!blob) { resolve(); return; }
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
        resolve();
      }, "image/png");
    });
  } catch {
    // Silent graceful failure — no alerts or errors shown to user
  }
}
