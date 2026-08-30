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
