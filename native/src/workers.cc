#include "workers.h"

#include <napi.h>
#include <alpm.h>

#include <string>
#include <vector>

#include "marshal.h"

namespace {

// Open() and Close() mutate Handle::open_/alpm_ themselves, so they can't
// use the generic HandleWorker<Result> (which requires the handle to
// already be open before Execute runs). They're written directly against
// Napi::AsyncWorker instead.

class OpenWorker : public Napi::AsyncWorker {
 public:
  OpenWorker(Napi::Env env, Handle* handle, std::string root, std::string dbpath)
      : Napi::AsyncWorker(env),
        deferred_(Napi::Promise::Deferred::New(env)),
        handle_(handle),
        root_(std::move(root)),
        dbpath_(std::move(dbpath)) {}

  Napi::Promise Promise() { return deferred_.Promise(); }

 protected:
  void Execute() override {
    std::lock_guard<std::mutex> lock(handle_->mutex_);
    if (handle_->open_) {
      SetError("handle is already open");
      return;
    }
    alpm_errno_t err = ALPM_ERR_OK;
    alpm_handle_t* alpm = alpm_initialize(root_.c_str(), dbpath_.c_str(), &err);
    if (alpm == nullptr) {
      err_ = err;
      SetError(alpm_strerror(err));
      return;
    }
    handle_->alpm_ = alpm;
    handle_->open_ = true;
  }

  void OnOK() override { deferred_.Resolve(Env().Undefined()); }

  void OnError(const Napi::Error& e) override {
    Napi::Error error = err_ == ALPM_ERR_OK ? e : MakeAlpmError(Env(), err_);
    deferred_.Reject(error.Value());
  }

 private:
  Napi::Promise::Deferred deferred_;
  Handle* handle_;
  std::string root_;
  std::string dbpath_;
  alpm_errno_t err_ = ALPM_ERR_OK;
};

class CloseWorker : public Napi::AsyncWorker {
 public:
  CloseWorker(Napi::Env env, Handle* handle)
      : Napi::AsyncWorker(env), deferred_(Napi::Promise::Deferred::New(env)), handle_(handle) {}

  Napi::Promise Promise() { return deferred_.Promise(); }

 protected:
  void Execute() override {
    std::lock_guard<std::mutex> lock(handle_->mutex_);
    if (!handle_->open_) {
      return;  // already closed: close() is idempotent
    }
    if (alpm_release(handle_->alpm_) != 0) {
      SetError("alpm_release failed");
    }
    handle_->alpm_ = nullptr;
    handle_->open_ = false;
  }

  void OnOK() override { deferred_.Resolve(Env().Undefined()); }
  void OnError(const Napi::Error& e) override { deferred_.Reject(e.Value()); }

 private:
  Napi::Promise::Deferred deferred_;
  Handle* handle_;
};

struct OptionsResult {
  std::string root;
  std::string dbpath;
  std::vector<std::string> cachedirs;
  std::vector<std::string> architectures;

  Napi::Value ToJs(Napi::Env env) const {
    Napi::Object obj = Napi::Object::New(env);
    obj.Set("root", Napi::String::New(env, root));
    obj.Set("dbpath", Napi::String::New(env, dbpath));
    obj.Set("cachedirs", StringsToJs(env, cachedirs));
    obj.Set("architectures", StringsToJs(env, architectures));
    return obj;
  }
};

class OptionsWorker : public HandleWorker<OptionsResult> {
 public:
  using HandleWorker::HandleWorker;

 protected:
  void RunAlpm(alpm_handle_t* alpm) override {
    const char* root = alpm_option_get_root(alpm);
    const char* dbpath = alpm_option_get_dbpath(alpm);
    result_.root = root != nullptr ? root : "";
    result_.dbpath = dbpath != nullptr ? dbpath : "";
    result_.cachedirs = CopyStringList(alpm_option_get_cachedirs(alpm));
    result_.architectures = CopyStringList(alpm_option_get_architectures(alpm));
  }
};

struct PackageListResult {
  std::vector<PackageRecord> packages;

  Napi::Value ToJs(Napi::Env env) const {
    Napi::Array arr = Napi::Array::New(env, packages.size());
    for (size_t i = 0; i < packages.size(); ++i) {
      arr.Set(i, packages[i].ToJs(env));
    }
    return arr;
  }
};

struct PackageOptionalResult {
  bool found = false;
  PackageRecord package;

  Napi::Value ToJs(Napi::Env env) const { return found ? package.ToJs(env) : env.Null(); }
};

// listPackages(dbName, fields): mirrors alpm_db_get_pkgcache - one call, one
// db. Multi-db listing (if ever needed) belongs in src/core/, same as
// search's multi-db merge below.
class ListPackagesWorker : public HandleWorker<PackageListResult> {
 public:
  ListPackagesWorker(Napi::Env env, Handle* h, std::string dbName, uint32_t fields)
      : HandleWorker(env, h), dbName_(std::move(dbName)), fields_(fields) {}

 protected:
  void RunAlpm(alpm_handle_t* alpm) override {
    alpm_db_t* db = ResolveDb(alpm, dbName_);
    if (db == nullptr) {
      SetAlpmError(ALPM_ERR_DB_NOT_FOUND);
      return;
    }
    const std::string resolvedName = alpm_db_get_name(db);
    // alpm_db_get_pkgcache returns a list the db owns - never freed here.
    for (alpm_list_t* i = alpm_db_get_pkgcache(db); i != nullptr; i = i->next) {
      result_.packages.push_back(MarshalPackage(static_cast<alpm_pkg_t*>(i->data), fields_, resolvedName));
    }
  }

 private:
  std::string dbName_;
  uint32_t fields_;
};

class GetPackageWorker : public HandleWorker<PackageOptionalResult> {
 public:
  GetPackageWorker(Napi::Env env, Handle* h, std::string dbName, std::string name, uint32_t fields)
      : HandleWorker(env, h), dbName_(std::move(dbName)), name_(std::move(name)), fields_(fields) {}

 protected:
  void RunAlpm(alpm_handle_t* alpm) override {
    alpm_db_t* db = ResolveDb(alpm, dbName_);
    if (db == nullptr) {
      SetAlpmError(ALPM_ERR_DB_NOT_FOUND);
      return;
    }
    // alpm_db_get_pkg returns a db-owned pointer, or NULL if not found (not
    // an error condition - getPackage resolves to null in that case).
    alpm_pkg_t* pkg = alpm_db_get_pkg(db, name_.c_str());
    if (pkg == nullptr) {
      result_.found = false;
      return;
    }
    result_.found = true;
    result_.package = MarshalPackage(pkg, fields_, alpm_db_get_name(db));
  }

 private:
  std::string dbName_;
  std::string name_;
  uint32_t fields_;
};

// search(dbName, needles, fields): alpm_db_search takes exactly one db per
// call (there is no multi-db overload in libalpm) - looping over several
// requested dbs and merging/deduping results by package name is
// Alpm.search()'s job in src/core/, not this addon's.
class SearchWorker : public HandleWorker<PackageListResult> {
 public:
  SearchWorker(Napi::Env env, Handle* h, std::string dbName, std::vector<std::string> needles, uint32_t fields)
      : HandleWorker(env, h), dbName_(std::move(dbName)), needles_(std::move(needles)), fields_(fields) {}

 protected:
  void RunAlpm(alpm_handle_t* alpm) override {
    alpm_db_t* db = ResolveDb(alpm, dbName_);
    if (db == nullptr) {
      SetAlpmError(ALPM_ERR_DB_NOT_FOUND);
      return;
    }

    // Payloads point into needles_ (owned by this worker for its lifetime),
    // so the spine built here is freed SpineOnly - never SpineAndPayload,
    // which would attempt to free() a std::string's internal buffer.
    alpm_list_t* needleList = nullptr;
    for (const std::string& needle : needles_) {
      needleList = alpm_list_add(needleList, const_cast<char*>(needle.c_str()));
    }
    AlpmListGuard needleGuard(needleList, ListFreeMode::SpineOnly);

    // alpm_db_search requires `ret` to start NULL on every call.
    alpm_list_t* ret = nullptr;
    if (alpm_db_search(db, needleGuard.get(), &ret) != 0) {
      SetAlpmError(alpm_errno(alpm));
      return;
    }
    // `ret`'s spine is caller-owned; the alpm_pkg_t* payloads are borrowed
    // from the db cache, same as alpm_db_get_pkgcache.
    AlpmListGuard retGuard(ret, ListFreeMode::SpineOnly);

    const std::string resolvedName = alpm_db_get_name(db);
    for (alpm_list_t* i = retGuard.get(); i != nullptr; i = i->next) {
      result_.packages.push_back(MarshalPackage(static_cast<alpm_pkg_t*>(i->data), fields_, resolvedName));
    }
  }

 private:
  std::string dbName_;
  std::vector<std::string> needles_;
  uint32_t fields_;
};

struct VoidResult {
  Napi::Value ToJs(Napi::Env env) const { return env.Undefined(); }
};

class RegisterSyncDbWorker : public HandleWorker<VoidResult> {
 public:
  RegisterSyncDbWorker(Napi::Env env, Handle* h, std::string name, int sigLevel, int usage)
      : HandleWorker(env, h), name_(std::move(name)), sigLevel_(sigLevel), usage_(usage) {}

 protected:
  void RunAlpm(alpm_handle_t* alpm) override {
    alpm_db_t* db = alpm_register_syncdb(alpm, name_.c_str(), sigLevel_);
    if (db == nullptr) {
      SetAlpmError(alpm_errno(alpm));
      return;
    }
    alpm_db_set_usage(db, usage_);
  }

 private:
  std::string name_;
  int sigLevel_;
  int usage_;
};

// alpm_option_set_architectures dupes the list it's given (matching every
// other alpm_option_set_* setter in this header), so the spine built here
// is freed SpineOnly right after the call.
class SetArchitecturesWorker : public HandleWorker<VoidResult> {
 public:
  SetArchitecturesWorker(Napi::Env env, Handle* h, std::vector<std::string> arches)
      : HandleWorker(env, h), arches_(std::move(arches)) {}

 protected:
  void RunAlpm(alpm_handle_t* alpm) override {
    alpm_list_t* list = nullptr;
    for (const std::string& arch : arches_) {
      list = alpm_list_add(list, const_cast<char*>(arch.c_str()));
    }
    AlpmListGuard guard(list, ListFreeMode::SpineOnly);
    alpm_option_set_architectures(alpm, guard.get());
  }

 private:
  std::vector<std::string> arches_;
};

class AddIgnorePkgWorker : public HandleWorker<VoidResult> {
 public:
  AddIgnorePkgWorker(Napi::Env env, Handle* h, std::string pkg) : HandleWorker(env, h), pkg_(std::move(pkg)) {}

 protected:
  void RunAlpm(alpm_handle_t* alpm) override { alpm_option_add_ignorepkg(alpm, pkg_.c_str()); }

 private:
  std::string pkg_;
};

// owners(path, fields?): a path is "owned" by whichever local package's
// filelist contains it. Paths in alpm_file_t are root-relative with no
// leading slash (confirmed against a real /var/lib/pacman/local entry), so
// the leading '/' a CLI user types is stripped before matching.
class OwnersWorker : public HandleWorker<PackageListResult> {
 public:
  OwnersWorker(Napi::Env env, Handle* h, std::string path, uint32_t fields)
      : HandleWorker(env, h), path_(std::move(path)), fields_(fields) {}

 protected:
  void RunAlpm(alpm_handle_t* alpm) override {
    if (!path_.empty() && path_.front() == '/') path_.erase(0, 1);
    alpm_db_t* db = alpm_get_localdb(alpm);
    for (alpm_list_t* i = alpm_db_get_pkgcache(db); i != nullptr; i = i->next) {
      auto* pkg = static_cast<alpm_pkg_t*>(i->data);
      const alpm_filelist_t* files = alpm_pkg_get_files(pkg);
      if (files != nullptr && alpm_filelist_contains(files, path_.c_str()) != nullptr) {
        result_.packages.push_back(MarshalPackage(pkg, fields_, "local"));
      }
    }
  }

 private:
  std::string path_;
  uint32_t fields_;
};

struct StringListResult {
  std::vector<std::string> names;
  Napi::Value ToJs(Napi::Env env) const { return StringsToJs(env, names); }
};

// requiredBy/optionalFor share everything except which alpm_pkg_compute_*
// function they call.
class RequiredByWorker : public HandleWorker<StringListResult> {
 public:
  RequiredByWorker(Napi::Env env, Handle* h, std::string dbName, std::string name, bool optional)
      : HandleWorker(env, h), dbName_(std::move(dbName)), name_(std::move(name)), optional_(optional) {}

 protected:
  void RunAlpm(alpm_handle_t* alpm) override {
    alpm_db_t* db = ResolveDb(alpm, dbName_);
    if (db == nullptr) {
      SetAlpmError(ALPM_ERR_DB_NOT_FOUND);
      return;
    }
    alpm_pkg_t* pkg = alpm_db_get_pkg(db, name_.c_str());
    if (pkg == nullptr) {
      SetAlpmError(ALPM_ERR_PKG_NOT_FOUND);
      return;
    }
    // Both return a newly allocated list of package names (char*) that the
    // header explicitly says the caller must free -> SpineAndPayload.
    alpm_list_t* list = optional_ ? alpm_pkg_compute_optionalfor(pkg) : alpm_pkg_compute_requiredby(pkg);
    AlpmListGuard guard(list, ListFreeMode::SpineAndPayload);
    result_.names = CopyStringList(guard.get());
  }

 private:
  std::string dbName_;
  std::string name_;
  bool optional_;
};

struct GroupListResult {
  std::vector<GroupRecord> groups;
  Napi::Value ToJs(Napi::Env env) const {
    Napi::Array arr = Napi::Array::New(env, groups.size());
    for (size_t i = 0; i < groups.size(); ++i) arr.Set(i, groups[i].ToJs(env));
    return arr;
  }
};

class GroupsWorker : public HandleWorker<GroupListResult> {
 public:
  GroupsWorker(Napi::Env env, Handle* h, std::string dbName) : HandleWorker(env, h), dbName_(std::move(dbName)) {}

 protected:
  void RunAlpm(alpm_handle_t* alpm) override {
    alpm_db_t* db = ResolveDb(alpm, dbName_);
    if (db == nullptr) {
      SetAlpmError(ALPM_ERR_DB_NOT_FOUND);
      return;
    }
    // alpm_db_get_groupcache returns a db-owned list - never freed here.
    for (alpm_list_t* i = alpm_db_get_groupcache(db); i != nullptr; i = i->next) {
      auto* group = static_cast<alpm_group_t*>(i->data);
      GroupRecord rec;
      rec.name = group->name != nullptr ? group->name : "";
      for (alpm_list_t* p = group->packages; p != nullptr; p = p->next) {
        rec.packages.emplace_back(alpm_pkg_get_name(static_cast<alpm_pkg_t*>(p->data)));
      }
      result_.groups.push_back(std::move(rec));
    }
  }

 private:
  std::string dbName_;
};

// newVersion(name, fields?): looks `name` up in the localdb, then asks which
// registered sync db (if any) carries a newer version. Resolves to null if
// the package isn't installed, isn't found in any sync db, or is already
// current - the same "not found is not an error" shape as getPackage.
class NewVersionWorker : public HandleWorker<PackageOptionalResult> {
 public:
  NewVersionWorker(Napi::Env env, Handle* h, std::string name, uint32_t fields)
      : HandleWorker(env, h), name_(std::move(name)), fields_(fields) {}

 protected:
  void RunAlpm(alpm_handle_t* alpm) override {
    alpm_pkg_t* local = alpm_db_get_pkg(alpm_get_localdb(alpm), name_.c_str());
    if (local == nullptr) {
      SetAlpmError(ALPM_ERR_PKG_NOT_FOUND);
      return;
    }
    alpm_pkg_t* newer = alpm_sync_get_new_version(local, alpm_get_syncdbs(alpm));
    if (newer == nullptr) {
      result_.found = false;
      return;
    }
    result_.found = true;
    result_.package = MarshalPackage(newer, fields_, alpm_db_get_name(alpm_pkg_get_db(newer)));
  }

 private:
  std::string name_;
  uint32_t fields_;
};

std::string OptionalDbNameArg(const Napi::CallbackInfo& info, size_t index) {
  if (info.Length() > index && info[index].IsString()) {
    return info[index].As<Napi::String>();
  }
  return "local";
}

uint32_t FieldsArg(const Napi::CallbackInfo& info, size_t index, uint32_t fallback) {
  if (info.Length() > index && info[index].IsNumber()) {
    return static_cast<uint32_t>(info[index].As<Napi::Number>().Int64Value());
  }
  return fallback;
}

}  // namespace

Napi::Value Handle::Open(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
    Napi::TypeError::New(env, "open(root, dbpath) expects two strings").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  auto* worker = new OpenWorker(env, this, info[0].As<Napi::String>(), info[1].As<Napi::String>());
  Napi::Promise promise = worker->Promise();
  worker->Queue();
  return promise;
}

Napi::Value Handle::Close(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto* worker = new CloseWorker(env, this);
  Napi::Promise promise = worker->Promise();
  worker->Queue();
  return promise;
}

Napi::Value Handle::Options(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto* worker = new OptionsWorker(env, this);
  Napi::Promise promise = worker->Promise();
  worker->Queue();
  return promise;
}

// listPackages(dbName?: string, fields?: number)
Napi::Value Handle::ListPackages(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto* worker = new ListPackagesWorker(env, this, OptionalDbNameArg(info, 0), FieldsArg(info, 1, Fields::Summary));
  Napi::Promise promise = worker->Promise();
  worker->Queue();
  return promise;
}

// getPackage(name: string, dbName?: string, fields?: number)
Napi::Value Handle::GetPackage(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "getPackage(name, dbName?, fields?) expects a string name").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  auto* worker = new GetPackageWorker(env, this, OptionalDbNameArg(info, 1), info[0].As<Napi::String>(),
                                       FieldsArg(info, 2, Fields::Full));
  Napi::Promise promise = worker->Promise();
  worker->Queue();
  return promise;
}

// search(needles: string[], dbName?: string, fields?: number)
Napi::Value Handle::Search(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsArray()) {
    Napi::TypeError::New(env, "search(needles, dbName?, fields?) expects an array of strings").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  Napi::Array needlesArr = info[0].As<Napi::Array>();
  std::vector<std::string> needles;
  needles.reserve(needlesArr.Length());
  for (uint32_t i = 0; i < needlesArr.Length(); ++i) {
    needles.push_back(needlesArr.Get(i).As<Napi::String>());
  }
  auto* worker =
      new SearchWorker(env, this, OptionalDbNameArg(info, 1), std::move(needles), FieldsArg(info, 2, Fields::Summary));
  Napi::Promise promise = worker->Promise();
  worker->Queue();
  return promise;
}

// registerSyncDb(name: string, sigLevel: number, usage?: number)
Napi::Value Handle::RegisterSyncDb(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsNumber()) {
    Napi::TypeError::New(env, "registerSyncDb(name, sigLevel, usage?) expects (string, number)")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  int usage = info.Length() > 2 && info[2].IsNumber() ? info[2].As<Napi::Number>().Int32Value() : 0xF;
  auto* worker = new RegisterSyncDbWorker(env, this, info[0].As<Napi::String>(),
                                           info[1].As<Napi::Number>().Int32Value(), usage);
  Napi::Promise promise = worker->Promise();
  worker->Queue();
  return promise;
}

// setArchitectures(architectures: string[])
Napi::Value Handle::SetArchitectures(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsArray()) {
    Napi::TypeError::New(env, "setArchitectures(architectures) expects an array of strings").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  Napi::Array archArr = info[0].As<Napi::Array>();
  std::vector<std::string> arches;
  arches.reserve(archArr.Length());
  for (uint32_t i = 0; i < archArr.Length(); ++i) {
    arches.push_back(archArr.Get(i).As<Napi::String>());
  }
  auto* worker = new SetArchitecturesWorker(env, this, std::move(arches));
  Napi::Promise promise = worker->Promise();
  worker->Queue();
  return promise;
}

// addIgnorePkg(pkg: string)
Napi::Value Handle::AddIgnorePkg(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "addIgnorePkg(pkg) expects a string").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  auto* worker = new AddIgnorePkgWorker(env, this, info[0].As<Napi::String>());
  Napi::Promise promise = worker->Promise();
  worker->Queue();
  return promise;
}

// owners(path: string, fields?: number)
Napi::Value Handle::Owners(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "owners(path, fields?) expects a string path").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  auto* worker = new OwnersWorker(env, this, info[0].As<Napi::String>(), FieldsArg(info, 1, Fields::Summary));
  Napi::Promise promise = worker->Promise();
  worker->Queue();
  return promise;
}

// requiredBy(name: string, dbName?: string)
Napi::Value Handle::RequiredBy(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "requiredBy(name, dbName?) expects a string name").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  auto* worker = new RequiredByWorker(env, this, OptionalDbNameArg(info, 1), info[0].As<Napi::String>(), false);
  Napi::Promise promise = worker->Promise();
  worker->Queue();
  return promise;
}

// optionalFor(name: string, dbName?: string)
Napi::Value Handle::OptionalFor(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "optionalFor(name, dbName?) expects a string name").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  auto* worker = new RequiredByWorker(env, this, OptionalDbNameArg(info, 1), info[0].As<Napi::String>(), true);
  Napi::Promise promise = worker->Promise();
  worker->Queue();
  return promise;
}

// groups(dbName?: string)
Napi::Value Handle::Groups(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto* worker = new GroupsWorker(env, this, OptionalDbNameArg(info, 0));
  Napi::Promise promise = worker->Promise();
  worker->Queue();
  return promise;
}

// newVersion(name: string, fields?: number)
Napi::Value Handle::NewVersion(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "newVersion(name, fields?) expects a string name").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  auto* worker = new NewVersionWorker(env, this, info[0].As<Napi::String>(), FieldsArg(info, 1, Fields::Summary));
  Napi::Promise promise = worker->Promise();
  worker->Queue();
  return promise;
}
