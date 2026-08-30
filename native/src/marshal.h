#pragma once

#include <napi.h>
#include <alpm.h>

#include <cstdint>
#include <string>
#include <vector>

// --- borrowed alpm_list_t<char*> helpers -----------------------------------

// Deep-copies a borrowed alpm_list_t of char* (e.g. alpm_option_get_cachedirs,
// alpm_option_get_architectures, alpm_pkg_get_licenses) into owned
// std::strings. Must run in Execute(), before any alpm_release/
// alpm_list_free could invalidate the underlying char*s. Does not free
// `list` - these getters return handle/pkg-owned lists.
std::vector<std::string> CopyStringList(alpm_list_t* list);

Napi::Array StringsToJs(Napi::Env env, const std::vector<std::string>& strings);

// --- alpm_list_t free discipline --------------------------------------------
//
// Two distinct free operations exist in libalpm and mixing them up is the
// single most likely leak/double-free bug in this addon:
//  - SpineOnly: the alpm_list_t spine is caller-owned but the void* payload
//    at each node is NOT (alpm_db_get_pkgcache, alpm_db_search's `ret`, or a
//    spine built locally from JS strings via alpm_list_add whose payloads
//    point into a std::string this worker separately owns) -> alpm_list_free.
//  - SpineAndPayload: both the spine and the payload (a malloc'd char*) are
//    caller-owned (alpm_pkg_compute_requiredby/_optionalfor, whose header
//    doc comments say the caller must free the result) -> FREELIST.
enum class ListFreeMode { SpineOnly, SpineAndPayload };

class AlpmListGuard {
 public:
  AlpmListGuard(alpm_list_t* list, ListFreeMode mode) : list_(list), mode_(mode) {}
  ~AlpmListGuard() {
    if (list_ == nullptr) return;
    if (mode_ == ListFreeMode::SpineAndPayload) {
      FREELIST(list_);
    } else {
      alpm_list_free(list_);
    }
  }
  AlpmListGuard(const AlpmListGuard&) = delete;
  AlpmListGuard& operator=(const AlpmListGuard&) = delete;

  alpm_list_t* get() const { return list_; }

 private:
  alpm_list_t* list_;
  ListFreeMode mode_;
};

// --- db resolution -----------------------------------------------------------

// "local"/empty -> alpm_get_localdb(); else looked up by name among
// alpm_get_syncdbs() (there is no alpm_get_syncdb_by_name in libalpm).
// Returns nullptr if a named sync db isn't registered.
alpm_db_t* ResolveDb(alpm_handle_t* alpm, const std::string& dbName);

// --- field selection ---------------------------------------------------------

// Bitmask controlling which fields MarshalPackage populates, so listing 1344
// packages doesn't marshal all ~25 fields when only summary columns are
// needed, and so we never hand JS a field we didn't just deep-copy fresh
// from a live alpm_pkg_t* (a lazily-evaluated getter would risk touching a
// pointer that's dangling by the time JS reads it).
namespace Fields {
constexpr uint32_t Name = 1u << 0;
constexpr uint32_t Version = 1u << 1;
constexpr uint32_t Db = 1u << 2;
constexpr uint32_t Isize = 1u << 3;
constexpr uint32_t Reason = 1u << 4;
constexpr uint32_t Desc = 1u << 5;
constexpr uint32_t Url = 1u << 6;
constexpr uint32_t Licenses = 1u << 7;
constexpr uint32_t Groups = 1u << 8;
constexpr uint32_t Depends = 1u << 9;
constexpr uint32_t Optdepends = 1u << 10;
constexpr uint32_t Provides = 1u << 11;
constexpr uint32_t Conflicts = 1u << 12;
constexpr uint32_t Replaces = 1u << 13;
constexpr uint32_t Packager = 1u << 14;
constexpr uint32_t Dates = 1u << 15;
constexpr uint32_t Validation = 1u << 16;
constexpr uint32_t Files = 1u << 17;

constexpr uint32_t Summary = Name | Version | Db | Isize | Reason;
constexpr uint32_t Full = Summary | Desc | Url | Licenses | Groups | Depends | Optdepends | Provides |
                           Conflicts | Replaces | Packager | Dates | Validation;
}  // namespace Fields

// --- package/dependency/file records -----------------------------------------

// {name, version, desc, mod} from alpm_depend_t, with `mod` mapped to a
// '>='|'='|... string (or '' for ALPM_DEP_MOD_ANY, i.e. no constraint).
struct DependencyRecord {
  std::string name;
  std::string version;
  std::string desc;
  std::string mod;

  Napi::Value ToJs(Napi::Env env) const;
};

DependencyRecord MarshalDependency(const alpm_depend_t* dep);
Napi::Array DependencyListToJs(Napi::Env env, const std::vector<DependencyRecord>& deps);

// alpm_pkg_get_files returns a {count, alpm_file_t*} array-of-structs, not an
// alpm_list_t - a distinct shape from every other pkg accessor, so it gets
// its own record type and marshal path.
struct FileRecord {
  std::string name;
  int64_t size = 0;
  uint32_t mode = 0;

  Napi::Value ToJs(Napi::Env env) const;
};

std::vector<FileRecord> MarshalFilelist(const alpm_filelist_t* filelist);
Napi::Array FileListToJs(Napi::Env env, const std::vector<FileRecord>& files);

struct PackageRecord {
  uint32_t fields = 0;  // which of the below were actually requested/populated

  std::string name;
  std::string version;
  std::string dbName;
  int64_t isize = 0;
  int reason = 0;  // alpm_pkgreason_t

  std::string desc;
  std::string url;
  std::vector<std::string> licenses;
  std::vector<std::string> groups;
  std::vector<DependencyRecord> depends;
  std::vector<DependencyRecord> optdepends;
  std::vector<std::string> provides;
  std::vector<std::string> conflicts;
  std::vector<std::string> replaces;
  std::string packager;
  int64_t builddate = 0;
  int64_t installdate = 0;
  int validation = 0;  // alpm_pkgvalidation_t bitmask

  std::vector<FileRecord> files;

  Napi::Value ToJs(Napi::Env env) const;
};

// {name, packages} from alpm_group_t - `packages` holds only names (an
// alpm_pkg_t* per member, marshaled to its full PackageRecord is what
// getPackage is for).
struct GroupRecord {
  std::string name;
  std::vector<std::string> packages;

  Napi::Value ToJs(Napi::Env env) const;
};

// Deep-copies every requested field out of a live alpm_pkg_t* into a plain
// PackageRecord. Must run inside Execute() (worker thread), before any
// alpm_release/alpm_db close could invalidate `pkg`. `dbName` is the
// caller-resolved db name (alpm_db_get_name), passed in rather than
// re-derived per package.
PackageRecord MarshalPackage(alpm_pkg_t* pkg, uint32_t fields, const std::string& dbName);
