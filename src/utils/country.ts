export function normalizeCountryKey(country: string | null | undefined): string {
  if (!country) return "";

  return country
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function countryMatches(
  country: string | null | undefined,
  selectedCountry: string | null | undefined
): boolean {
  if (!selectedCountry) return true;
  return normalizeCountryKey(country) === normalizeCountryKey(selectedCountry);
}

export function resolveCountryName(
  country: string | null | undefined,
  countries: string[]
): string {
  if (!country) return "";

  const key = normalizeCountryKey(country);
  return countries.find((candidate) => normalizeCountryKey(candidate) === key) || country.trim();
}
