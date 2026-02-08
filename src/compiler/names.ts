/**
 * Generate creative newsletter names in the style of crossword puzzle titles.
 * Witty, memorable, and not slop.
 */

const ADJECTIVES = [
  "Lobster's",
  "Claw's",
  "Shell's",
  "Crimson",
  "Deep",
  "Midnight",
  "Electric",
  "Quantum",
  "Silent",
  "Swift",
  "Iron",
  "Crystal",
  "Ember",
  "Frost",
  "Velvet",
  "Neon",
  "Copper",
  "Phantom",
  "Solar",
  "Lunar",
];

const NOUNS = [
  "Gambit",
  "Paradox",
  "Echo",
  "Cipher",
  "Protocol",
  "Vector",
  "Signal",
  "Theorem",
  "Axiom",
  "Drift",
  "Pulse",
  "Surge",
  "Breach",
  "Summit",
  "Vault",
  "Spiral",
  "Nexus",
  "Forge",
  "Bloom",
  "Tide",
];

// For special occasions
const SPECIAL_NAMES: Record<string, string> = {
  "01-01": "Fresh Molt",
  "02-14": "Claw & Heart",
  "10-31": "Spectral Shell",
  "12-25": "Frost Pincer",
};

/**
 * Generate a deterministic but varied name for a given date.
 */
export function generateName(date: Date): string {
  const monthDay = `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  
  // Check for special dates
  if (SPECIAL_NAMES[monthDay]) {
    return SPECIAL_NAMES[monthDay];
  }

  // Use date as seed for deterministic selection
  const dayOfYear = Math.floor(
    (date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) /
      (1000 * 60 * 60 * 24)
  );

  const adjIndex = dayOfYear % ADJECTIVES.length;
  const nounIndex = Math.floor(dayOfYear / ADJECTIVES.length) % NOUNS.length;

  return `${ADJECTIVES[adjIndex]} ${NOUNS[nounIndex]}`;
}

/**
 * Generate newsletter ID in format MS-YYYY-DDD
 * where DDD is day of year (001-366)
 */
export function generateId(date: Date): string {
  const year = date.getFullYear();
  const dayOfYear = Math.floor(
    (date.getTime() - new Date(year, 0, 0).getTime()) / (1000 * 60 * 60 * 24)
  );
  return `MS-${year}-${String(dayOfYear).padStart(3, "0")}`;
}
