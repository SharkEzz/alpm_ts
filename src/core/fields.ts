// Bitmask controlling which package fields getPackage/listPackages/search
// populate. src/core/koffi/marshal.ts's marshalPackage imports these
// constants directly (single source of truth, not a duplicated layout to
// keep in sync by hand).
export const FIELD_NAME = 1 << 0;
export const FIELD_VERSION = 1 << 1;
export const FIELD_DB = 1 << 2;
export const FIELD_ISIZE = 1 << 3;
export const FIELD_REASON = 1 << 4;
export const FIELD_DESC = 1 << 5;
export const FIELD_URL = 1 << 6;
export const FIELD_LICENSES = 1 << 7;
export const FIELD_GROUPS = 1 << 8;
export const FIELD_DEPENDS = 1 << 9;
export const FIELD_OPTDEPENDS = 1 << 10;
export const FIELD_PROVIDES = 1 << 11;
export const FIELD_CONFLICTS = 1 << 12;
export const FIELD_REPLACES = 1 << 13;
export const FIELD_PACKAGER = 1 << 14;
export const FIELD_DATES = 1 << 15;
export const FIELD_VALIDATION = 1 << 16;
export const FIELD_FILES = 1 << 17;

export const FIELDS_SUMMARY = FIELD_NAME | FIELD_VERSION | FIELD_DB | FIELD_ISIZE | FIELD_REASON;
export const FIELDS_FULL =
  FIELDS_SUMMARY |
  FIELD_DESC |
  FIELD_URL |
  FIELD_LICENSES |
  FIELD_GROUPS |
  FIELD_DEPENDS |
  FIELD_OPTDEPENDS |
  FIELD_PROVIDES |
  FIELD_CONFLICTS |
  FIELD_REPLACES |
  FIELD_PACKAGER |
  FIELD_DATES |
  FIELD_VALIDATION;
export const FIELDS_FILES = FIELD_FILES;
