/**
 * Writes oven and oil temperatures the way people read them: "350F" -> "350°F",
 * "180 C" -> "180°C".
 *
 * The catalog, the scanner and most people typing a recipe write the bare
 * letter, so this is applied where step text is shown rather than fixed in the
 * data. Only two- and three-digit numbers count as temperatures, which keeps
 * "2 C" (two cups) and "4F" out of it; a letter already preceded by a degree
 * sign is left alone. Timer parsing reads the original text, not this.
 */
const TEMPERATURE = /\b(\d{2,3}) ?([FC])\b/g;

export function formatTemperatures(text: string): string {
  return text.replace(TEMPERATURE, '$1°$2');
}
