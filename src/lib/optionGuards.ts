/**
 * Narrow a raw string (e.g. a <select> value) to one of a known set of literal options.
 * Returns undefined when the value is not an allowed option.
 */
export function pickOption<T extends string>(options: readonly T[], value: string): T | undefined {
  return options.find((option) => option === value);
}
