"use client";

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function buildStandaloneSvg(svgEl: SVGSVGElement): {
  markup: string;
  width: number;
  height: number;
} {
  const rect = svgEl.getBoundingClientRect();
  const width = Math.max(400, Math.round(rect.width || 800));
  const height = Math.max(300, Math.round(rect.height || 600));

  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.setAttribute("viewBox", `0 0 ${width} ${height}`);

  // Strip selection overlays from exported image
  clone.querySelectorAll("[data-testid='selection-overlay']").forEach((el) => el.remove());

  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("width", "100%");
  bg.setAttribute("height", "100%");
  bg.setAttribute("fill", "#fafafa");
  clone.insertBefore(bg, clone.firstChild);

  const serializer = new XMLSerializer();
  return { markup: serializer.serializeToString(clone), width, height };
}

export function exportCanvasAsSvg(svgEl: SVGSVGElement | null, filename = "synccanvas.svg"): void {
  if (!svgEl) return;
  const { markup } = buildStandaloneSvg(svgEl);
  const blob = new Blob([markup], { type: "image/svg+xml;charset=utf-8" });
  triggerDownload(blob, filename);
}

export function exportCanvasAsPng(svgEl: SVGSVGElement | null, filename = "synccanvas.png"): void {
  if (!svgEl) return;
  const { markup, width, height } = buildStandaloneSvg(svgEl);
  const svgBlob = new Blob([markup], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);

  const img = new Image();
  img.onload = () => {
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((pngBlob) => {
        if (pngBlob) {
          triggerDownload(pngBlob, filename);
        }
      }, "image/png");
    }
    URL.revokeObjectURL(url);
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
  };
  img.src = url;
}
