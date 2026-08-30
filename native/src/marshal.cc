#include "marshal.h"

namespace {

std::string DepModToString(alpm_depmod_t mod) {
  switch (mod) {
    case ALPM_DEP_MOD_ANY:
      return "";
    case ALPM_DEP_MOD_EQ:
      return "=";
    case ALPM_DEP_MOD_GE:
      return ">=";
    case ALPM_DEP_MOD_LE:
      return "<=";
    case ALPM_DEP_MOD_GT:
      return ">";
    case ALPM_DEP_MOD_LT:
      return "<";
    default:
      return "";
  }
}

std::string OrEmpty(const char* s) { return s != nullptr ? s : ""; }

}  // namespace

std::vector<std::string> CopyStringList(alpm_list_t* list) {
  std::vector<std::string> out;
  for (alpm_list_t* i = list; i != nullptr; i = i->next) {
    out.emplace_back(static_cast<const char*>(i->data));
  }
  return out;
}

Napi::Array StringsToJs(Napi::Env env, const std::vector<std::string>& strings) {
  Napi::Array arr = Napi::Array::New(env, strings.size());
  for (size_t i = 0; i < strings.size(); ++i) {
    arr.Set(i, Napi::String::New(env, strings[i]));
  }
  return arr;
}

alpm_db_t* ResolveDb(alpm_handle_t* alpm, const std::string& dbName) {
  if (dbName.empty() || dbName == "local") {
    return alpm_get_localdb(alpm);
  }
  for (alpm_list_t* i = alpm_get_syncdbs(alpm); i != nullptr; i = i->next) {
    auto* db = static_cast<alpm_db_t*>(i->data);
    if (dbName == alpm_db_get_name(db)) {
      return db;
    }
  }
  return nullptr;
}

Napi::Value DependencyRecord::ToJs(Napi::Env env) const {
  Napi::Object obj = Napi::Object::New(env);
  obj.Set("name", Napi::String::New(env, name));
  obj.Set("version", Napi::String::New(env, version));
  obj.Set("desc", Napi::String::New(env, desc));
  obj.Set("mod", Napi::String::New(env, mod));
  return obj;
}

DependencyRecord MarshalDependency(const alpm_depend_t* dep) {
  DependencyRecord rec;
  rec.name = OrEmpty(dep->name);
  rec.version = OrEmpty(dep->version);
  rec.desc = OrEmpty(dep->desc);
  rec.mod = DepModToString(dep->mod);
  return rec;
}

Napi::Array DependencyListToJs(Napi::Env env, const std::vector<DependencyRecord>& deps) {
  Napi::Array arr = Napi::Array::New(env, deps.size());
  for (size_t i = 0; i < deps.size(); ++i) {
    arr.Set(i, deps[i].ToJs(env));
  }
  return arr;
}

Napi::Value FileRecord::ToJs(Napi::Env env) const {
  Napi::Object obj = Napi::Object::New(env);
  obj.Set("name", Napi::String::New(env, name));
  obj.Set("size", Napi::Number::New(env, static_cast<double>(size)));
  obj.Set("mode", Napi::Number::New(env, mode));
  return obj;
}

std::vector<FileRecord> MarshalFilelist(const alpm_filelist_t* filelist) {
  std::vector<FileRecord> out;
  if (filelist == nullptr) return out;
  out.reserve(filelist->count);
  for (size_t i = 0; i < filelist->count; ++i) {
    const alpm_file_t& f = filelist->files[i];
    out.push_back(FileRecord{OrEmpty(f.name), static_cast<int64_t>(f.size), static_cast<uint32_t>(f.mode)});
  }
  return out;
}

Napi::Array FileListToJs(Napi::Env env, const std::vector<FileRecord>& files) {
  Napi::Array arr = Napi::Array::New(env, files.size());
  for (size_t i = 0; i < files.size(); ++i) {
    arr.Set(i, files[i].ToJs(env));
  }
  return arr;
}

Napi::Value GroupRecord::ToJs(Napi::Env env) const {
  Napi::Object obj = Napi::Object::New(env);
  obj.Set("name", Napi::String::New(env, name));
  obj.Set("packages", StringsToJs(env, packages));
  return obj;
}

PackageRecord MarshalPackage(alpm_pkg_t* pkg, uint32_t fields, const std::string& dbName) {
  PackageRecord rec;
  rec.fields = fields;

  if (fields & Fields::Name) rec.name = OrEmpty(alpm_pkg_get_name(pkg));
  if (fields & Fields::Version) rec.version = OrEmpty(alpm_pkg_get_version(pkg));
  if (fields & Fields::Db) rec.dbName = dbName;
  if (fields & Fields::Isize) rec.isize = static_cast<int64_t>(alpm_pkg_get_isize(pkg));
  if (fields & Fields::Reason) rec.reason = static_cast<int>(alpm_pkg_get_reason(pkg));

  if (fields & Fields::Desc) rec.desc = OrEmpty(alpm_pkg_get_desc(pkg));
  if (fields & Fields::Url) rec.url = OrEmpty(alpm_pkg_get_url(pkg));
  if (fields & Fields::Licenses) rec.licenses = CopyStringList(alpm_pkg_get_licenses(pkg));
  if (fields & Fields::Groups) rec.groups = CopyStringList(alpm_pkg_get_groups(pkg));

  if (fields & Fields::Depends) {
    for (alpm_list_t* i = alpm_pkg_get_depends(pkg); i != nullptr; i = i->next) {
      rec.depends.push_back(MarshalDependency(static_cast<alpm_depend_t*>(i->data)));
    }
  }
  if (fields & Fields::Optdepends) {
    for (alpm_list_t* i = alpm_pkg_get_optdepends(pkg); i != nullptr; i = i->next) {
      rec.optdepends.push_back(MarshalDependency(static_cast<alpm_depend_t*>(i->data)));
    }
  }
  if (fields & Fields::Provides) {
    for (alpm_list_t* i = alpm_pkg_get_provides(pkg); i != nullptr; i = i->next) {
      auto dep = MarshalDependency(static_cast<alpm_depend_t*>(i->data));
      rec.provides.push_back(dep.mod.empty() ? dep.name : dep.name + dep.mod + dep.version);
    }
  }
  if (fields & Fields::Conflicts) {
    for (alpm_list_t* i = alpm_pkg_get_conflicts(pkg); i != nullptr; i = i->next) {
      auto dep = MarshalDependency(static_cast<alpm_depend_t*>(i->data));
      rec.conflicts.push_back(dep.mod.empty() ? dep.name : dep.name + dep.mod + dep.version);
    }
  }
  if (fields & Fields::Replaces) {
    for (alpm_list_t* i = alpm_pkg_get_replaces(pkg); i != nullptr; i = i->next) {
      auto dep = MarshalDependency(static_cast<alpm_depend_t*>(i->data));
      rec.replaces.push_back(dep.mod.empty() ? dep.name : dep.name + dep.mod + dep.version);
    }
  }

  if (fields & Fields::Packager) rec.packager = OrEmpty(alpm_pkg_get_packager(pkg));
  if (fields & Fields::Dates) {
    rec.builddate = static_cast<int64_t>(alpm_pkg_get_builddate(pkg));
    rec.installdate = static_cast<int64_t>(alpm_pkg_get_installdate(pkg));
  }
  if (fields & Fields::Validation) rec.validation = alpm_pkg_get_validation(pkg);

  if (fields & Fields::Files) rec.files = MarshalFilelist(alpm_pkg_get_files(pkg));

  return rec;
}

Napi::Value PackageRecord::ToJs(Napi::Env env) const {
  Napi::Object obj = Napi::Object::New(env);
  if (fields & Fields::Name) obj.Set("name", Napi::String::New(env, name));
  if (fields & Fields::Version) obj.Set("version", Napi::String::New(env, version));
  if (fields & Fields::Db) obj.Set("db", Napi::String::New(env, dbName));
  if (fields & Fields::Isize) obj.Set("isize", Napi::Number::New(env, static_cast<double>(isize)));
  if (fields & Fields::Reason) obj.Set("reason", Napi::Number::New(env, reason));

  if (fields & Fields::Desc) obj.Set("desc", Napi::String::New(env, desc));
  if (fields & Fields::Url) obj.Set("url", Napi::String::New(env, url));
  if (fields & Fields::Licenses) obj.Set("licenses", StringsToJs(env, licenses));
  if (fields & Fields::Groups) obj.Set("groups", StringsToJs(env, groups));
  if (fields & Fields::Depends) obj.Set("depends", DependencyListToJs(env, depends));
  if (fields & Fields::Optdepends) obj.Set("optdepends", DependencyListToJs(env, optdepends));
  if (fields & Fields::Provides) obj.Set("provides", StringsToJs(env, provides));
  if (fields & Fields::Conflicts) obj.Set("conflicts", StringsToJs(env, conflicts));
  if (fields & Fields::Replaces) obj.Set("replaces", StringsToJs(env, replaces));
  if (fields & Fields::Packager) obj.Set("packager", Napi::String::New(env, packager));
  if (fields & Fields::Dates) {
    obj.Set("builddate", Napi::Number::New(env, static_cast<double>(builddate)));
    obj.Set("installdate", Napi::Number::New(env, static_cast<double>(installdate)));
  }
  if (fields & Fields::Validation) obj.Set("validation", Napi::Number::New(env, validation));
  if (fields & Fields::Files) obj.Set("files", FileListToJs(env, files));

  return obj;
}
