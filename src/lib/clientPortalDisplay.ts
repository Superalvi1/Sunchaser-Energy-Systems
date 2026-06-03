export const NO_DATA = "No data available";

export function displayOrNoData(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return NO_DATA;
  if (typeof value === "string" && value.trim() === "") return NO_DATA;
  return String(value);
}

export function displayKw(size: number | null | undefined): string {
  if (size == null || Number.isNaN(size)) return NO_DATA;
  return `${size} kW`;
}
