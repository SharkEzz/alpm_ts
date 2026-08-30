// Index == alpm_errno_t value (alpm.h:206). Extracted in enum declaration
// order directly from the installed header (56 entries, ALPM_ERR_OK=0
// through ALPM_ERR_MISSING_CAPABILITY_SIGNATURES=55) - not the ~120 the
// initial estimate assumed.
const ERRNO_NAMES = [
  "ALPM_ERR_OK",
  "ALPM_ERR_MEMORY",
  "ALPM_ERR_SYSTEM",
  "ALPM_ERR_BADPERMS",
  "ALPM_ERR_NOT_A_FILE",
  "ALPM_ERR_NOT_A_DIR",
  "ALPM_ERR_WRONG_ARGS",
  "ALPM_ERR_DISK_SPACE",
  "ALPM_ERR_HANDLE_NULL",
  "ALPM_ERR_HANDLE_NOT_NULL",
  "ALPM_ERR_HANDLE_LOCK",
  "ALPM_ERR_DB_OPEN",
  "ALPM_ERR_DB_CREATE",
  "ALPM_ERR_DB_NULL",
  "ALPM_ERR_DB_NOT_NULL",
  "ALPM_ERR_DB_NOT_FOUND",
  "ALPM_ERR_DB_INVALID",
  "ALPM_ERR_DB_INVALID_SIG",
  "ALPM_ERR_DB_VERSION",
  "ALPM_ERR_DB_WRITE",
  "ALPM_ERR_DB_REMOVE",
  "ALPM_ERR_SERVER_BAD_URL",
  "ALPM_ERR_SERVER_NONE",
  "ALPM_ERR_TRANS_NOT_NULL",
  "ALPM_ERR_TRANS_NULL",
  "ALPM_ERR_TRANS_DUP_TARGET",
  "ALPM_ERR_TRANS_DUP_FILENAME",
  "ALPM_ERR_TRANS_NOT_INITIALIZED",
  "ALPM_ERR_TRANS_NOT_PREPARED",
  "ALPM_ERR_TRANS_ABORT",
  "ALPM_ERR_TRANS_TYPE",
  "ALPM_ERR_TRANS_NOT_LOCKED",
  "ALPM_ERR_TRANS_HOOK_FAILED",
  "ALPM_ERR_PKG_NOT_FOUND",
  "ALPM_ERR_PKG_IGNORED",
  "ALPM_ERR_PKG_INVALID",
  "ALPM_ERR_PKG_INVALID_CHECKSUM",
  "ALPM_ERR_PKG_INVALID_SIG",
  "ALPM_ERR_PKG_MISSING_SIG",
  "ALPM_ERR_PKG_OPEN",
  "ALPM_ERR_PKG_CANT_REMOVE",
  "ALPM_ERR_PKG_INVALID_NAME",
  "ALPM_ERR_PKG_INVALID_ARCH",
  "ALPM_ERR_SIG_MISSING",
  "ALPM_ERR_SIG_INVALID",
  "ALPM_ERR_UNSATISFIED_DEPS",
  "ALPM_ERR_CONFLICTING_DEPS",
  "ALPM_ERR_FILE_CONFLICTS",
  "ALPM_ERR_RETRIEVE_PREPARE",
  "ALPM_ERR_RETRIEVE",
  "ALPM_ERR_INVALID_REGEX",
  "ALPM_ERR_LIBARCHIVE",
  "ALPM_ERR_LIBCURL",
  "ALPM_ERR_EXTERNAL_DOWNLOAD",
  "ALPM_ERR_GPGME",
  "ALPM_ERR_MISSING_CAPABILITY_SIGNATURES",
] as const;

export class AlpmError extends Error {
  readonly code: number;
  readonly name: string;

  constructor(code: number, message: string) {
    super(message);
    this.code = code;
    this.name = ERRNO_NAMES[code] ?? `ALPM_ERR_UNKNOWN_${code}`;
  }

  static fromNative(err: unknown): AlpmError {
    if (err instanceof Error && typeof (err as { code?: unknown }).code === "number") {
      const code = (err as Error & { code: number }).code;
      return new AlpmError(code, err.message);
    }
    const message = err instanceof Error ? err.message : String(err);
    return new AlpmError(-1, message);
  }
}

/** True if `err` is a rejection carrying a real alpm_errno_t (see src/core/koffi/backend.ts's makeAlpmError). */
export function isNativeAlpmError(err: unknown): boolean {
  return err instanceof Error && typeof (err as { code?: unknown }).code === "number";
}
