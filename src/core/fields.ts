// Mirrors native/src/marshal.h's Fields namespace exactly - kept in sync by
// hand since it's a small, stable bit layout shared across the N-API
// boundary as plain numbers (no shared header to generate this from).
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
