export const SWATCHES = {
  yellow: "#ffe082",
  orange: "#ffc591",
  pink: "#ffc1df",
  purple: "#d5c2ff",
  blue: "#a9d5ff",
  teal: "#9de0dc",
  green: "#a7e8b5",
  peach: "#ffd5bd",
};
export const COLORS = Object.keys(SWATCHES);
export const isColor = (color) =>
  typeof color === "string" &&
  (Object.hasOwn(SWATCHES, color) || /^#[\da-f]{6}$/i.test(color));
export const colorValue = (color) =>
  Object.hasOwn(SWATCHES, color)
    ? SWATCHES[color]
    : isColor(color)
      ? color.toLowerCase()
      : SWATCHES.yellow;
export const colorName = (color) =>
  Object.hasOwn(SWATCHES, color)
    ? color[0].toUpperCase() + color.slice(1)
    : `Custom ${colorValue(color)}`;
export const highlightName = (color) =>
  `ph-${color.startsWith("#") ? `custom-${color.slice(1).toLowerCase()}` : color}`;
export function textColor(color) {
  const rgb = colorValue(color)
    .slice(1)
    .match(/../g)
    .map((hex) => {
      const value = parseInt(hex, 16) / 255;
      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    });
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 > 0.179
    ? "#181c24"
    : "#ffffff";
}
