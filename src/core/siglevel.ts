// Bitfield values from /usr/include/alpm.h (alpm_siglevel_t, alpm.h:382) and
// (alpm_db_usage_t, alpm.h:1444). Confirmed against the installed header,
// not assumed from documentation alone.
export const ALPM_SIG_PACKAGE = 1 << 0;
export const ALPM_SIG_PACKAGE_OPTIONAL = 1 << 1;
export const ALPM_SIG_PACKAGE_MARGINAL_OK = 1 << 2;
export const ALPM_SIG_PACKAGE_UNKNOWN_OK = 1 << 3;
export const ALPM_SIG_DATABASE = 1 << 10;
export const ALPM_SIG_DATABASE_OPTIONAL = 1 << 11;
export const ALPM_SIG_DATABASE_MARGINAL_OK = 1 << 12;
export const ALPM_SIG_DATABASE_UNKNOWN_OK = 1 << 13;
export const ALPM_SIG_USE_DEFAULT = 1 << 30;

export const ALPM_DB_USAGE_SYNC = 1 << 0;
export const ALPM_DB_USAGE_SEARCH = 1 << 1;
export const ALPM_DB_USAGE_INSTALL = 1 << 2;
export const ALPM_DB_USAGE_UPGRADE = 1 << 3;
export const ALPM_DB_USAGE_ALL = (1 << 4) - 1;

const PACKAGE_CHECK = ALPM_SIG_PACKAGE | ALPM_SIG_PACKAGE_OPTIONAL;
const PACKAGE_TRUST = ALPM_SIG_PACKAGE_MARGINAL_OK | ALPM_SIG_PACKAGE_UNKNOWN_OK;
const DATABASE_CHECK = ALPM_SIG_DATABASE | ALPM_SIG_DATABASE_OPTIONAL;
const DATABASE_TRUST = ALPM_SIG_DATABASE_MARGINAL_OK | ALPM_SIG_DATABASE_UNKNOWN_OK;

/**
 * Turns a cumulative SigLevel word list (pacman.conf(5): "processed in
 * top-to-bottom, left-to-right fashion, where later options override
 * and/or supplement earlier ones") into an ALPM_SIG_* bitmask.
 *
 * Composing [options]'s words with a repo's own words is the caller's job:
 * `resolveSigLevel([...optionsWords, ...repoWords])` implements pacman's
 * "repo inherits options, then overrides" rule for free, since the
 * algorithm is inherently cumulative in word order.
 *
 * An empty word list returns ALPM_SIG_USE_DEFAULT (bit 30) - "let libalpm
 * apply its own built-in default" (documented as `Required TrustedOnly`),
 * matching pacman.conf(5)'s "or the built-in system default ... if not
 * specified".
 */
export function resolveSigLevel(words: readonly string[]): number {
  if (words.length === 0) {
    return ALPM_SIG_USE_DEFAULT;
  }
  let level = 0;
  for (const word of words) {
    switch (word) {
      case "Default":
        level = ALPM_SIG_USE_DEFAULT;
        break;
      case "Never":
        level &= ~(PACKAGE_CHECK | DATABASE_CHECK);
        break;
      case "Optional":
        level = (level & ~(PACKAGE_CHECK | DATABASE_CHECK)) | ALPM_SIG_PACKAGE_OPTIONAL | ALPM_SIG_DATABASE_OPTIONAL;
        break;
      case "Required":
        level = (level & ~(PACKAGE_CHECK | DATABASE_CHECK)) | ALPM_SIG_PACKAGE | ALPM_SIG_DATABASE;
        break;
      case "TrustedOnly":
        level &= ~(PACKAGE_TRUST | DATABASE_TRUST);
        break;
      case "TrustAll":
        level |= PACKAGE_TRUST | DATABASE_TRUST;
        break;
      case "PackageNever":
        level &= ~PACKAGE_CHECK;
        break;
      case "PackageOptional":
        level = (level & ~PACKAGE_CHECK) | ALPM_SIG_PACKAGE_OPTIONAL;
        break;
      case "PackageRequired":
        level = (level & ~PACKAGE_CHECK) | ALPM_SIG_PACKAGE;
        break;
      case "PackageTrustedOnly":
        level &= ~PACKAGE_TRUST;
        break;
      case "PackageTrustAll":
        level |= PACKAGE_TRUST;
        break;
      case "DatabaseNever":
        level &= ~DATABASE_CHECK;
        break;
      case "DatabaseOptional":
        level = (level & ~DATABASE_CHECK) | ALPM_SIG_DATABASE_OPTIONAL;
        break;
      case "DatabaseRequired":
        level = (level & ~DATABASE_CHECK) | ALPM_SIG_DATABASE;
        break;
      case "DatabaseTrustedOnly":
        level &= ~DATABASE_TRUST;
        break;
      case "DatabaseTrustAll":
        level |= DATABASE_TRUST;
        break;
      default:
        throw new Error(`unknown SigLevel word: ${word}`);
    }
  }
  return level;
}

/**
 * Turns a Usage word list into an ALPM_DB_USAGE_* bitmask. An empty word
 * list returns ALPM_DB_USAGE_ALL - pacman.conf(5): "All ... is the default
 * if not specified."
 */
export function resolveUsage(words: readonly string[]): number {
  if (words.length === 0) {
    return ALPM_DB_USAGE_ALL;
  }
  let usage = 0;
  for (const word of words) {
    switch (word) {
      case "Sync":
        usage |= ALPM_DB_USAGE_SYNC;
        break;
      case "Search":
        usage |= ALPM_DB_USAGE_SEARCH;
        break;
      case "Install":
        usage |= ALPM_DB_USAGE_INSTALL;
        break;
      case "Upgrade":
        usage |= ALPM_DB_USAGE_UPGRADE;
        break;
      case "All":
        usage |= ALPM_DB_USAGE_ALL;
        break;
      default:
        throw new Error(`unknown Usage word: ${word}`);
    }
  }
  return usage;
}
