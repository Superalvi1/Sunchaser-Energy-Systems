/** Shared watermark placement, scale, and opacity for PDF + live preview. */

export type WatermarkPlacement =
  | "center"
  | "top-center"
  | "bottom-center"
  | "top-right"
  | "top-left"
  | "cover"
  | "contain";

export type WatermarkStyleInput = {
  opacity?: number;
  scale?: number;
  position?: WatermarkPlacement | string;
  repeat?: string;
};

export const WATERMARK_PLACEMENT_OPTIONS: { value: WatermarkPlacement; label: string }[] = [
  { value: "center", label: "Center" },
  { value: "top-center", label: "Top Center" },
  { value: "bottom-center", label: "Bottom Center" },
  { value: "top-right", label: "Top Right" },
  { value: "top-left", label: "Top Left" },
];

const PLACEMENT_BACKGROUND: Record<string, string> = {
  center: "center center",
  "top-center": "top center",
  "bottom-center": "bottom center",
  "top-right": "top 6% right 6%",
  "top-left": "top 6% left 6%",
};

export function normalizeWatermarkPlacement(value: unknown): WatermarkPlacement {
  const raw = String(value || "center");
  const allowed: WatermarkPlacement[] = [
    "center",
    "top-center",
    "bottom-center",
    "top-right",
    "top-left",
    "cover",
    "contain",
  ];
  return allowed.includes(raw as WatermarkPlacement) ? (raw as WatermarkPlacement) : "center";
}

export function normalizeWatermarkScale(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 60;
  return Math.min(100, Math.max(10, Math.round(n)));
}

export function normalizeWatermarkOpacity(value: unknown, fallback = 0.08): number {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(0.2, Math.max(0, n));
}

export function resolveWatermarkStyles(wm?: WatermarkStyleInput | null) {
  const opacity = normalizeWatermarkOpacity(wm?.opacity);
  const repeat = wm?.repeat || "no-repeat";
  const position = normalizeWatermarkPlacement(wm?.position);

  if (position === "cover") {
    return {
      opacity,
      repeat,
      backgroundSize: "cover",
      backgroundPosition: "center center",
    };
  }
  if (position === "contain") {
    return {
      opacity,
      repeat,
      backgroundSize: "contain",
      backgroundPosition: "center center",
    };
  }

  const scale = normalizeWatermarkScale(wm?.scale);
  return {
    opacity,
    repeat,
    backgroundSize: `${scale}% auto`,
    backgroundPosition: PLACEMENT_BACKGROUND[position] || "center center",
  };
}

export function getWatermarkLayerInlineStyle(
  imageUrl: string,
  wm?: WatermarkStyleInput | null
): Record<string, string | number> {
  const styles = resolveWatermarkStyles(wm);
  return {
    position: "absolute",
    inset: 0,
    backgroundImage: `url('${String(imageUrl).replace(/'/g, "\\'")}')`,
    backgroundRepeat: String(styles.repeat),
    backgroundPosition: String(styles.backgroundPosition),
    backgroundSize: String(styles.backgroundSize),
    opacity: styles.opacity,
    pointerEvents: "none",
    zIndex: 0,
  };
}

export function watermarkLayerStyleAttr(
  imageUrl: string,
  wm?: WatermarkStyleInput | null
): string {
  const style = getWatermarkLayerInlineStyle(imageUrl, wm);
  return Object.entries(style)
    .map(([key, value]) => {
      const cssKey = key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
      return `${cssKey}:${value}`;
    })
    .join(";");
}
