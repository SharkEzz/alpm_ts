#pragma once

#include <napi.h>
#include <alpm.h>

#include <mutex>
#include <string>

#include "handle.h"

// Builds a JS Error carrying the raw alpm_errno_t as `code`, so src/core's
// errors.ts can map it to a named AlpmError without the native layer having
// to duplicate that ~56-entry table.
inline Napi::Error MakeAlpmError(Napi::Env env, alpm_errno_t err) {
  Napi::Error error = Napi::Error::New(env, alpm_strerror(err));
  error.Set("code", Napi::Number::New(env, static_cast<int>(err)));
  return error;
}

// Reusable base for every read-only query worker (listPackages, getPackage,
// search, ...): takes the handle's mutex only inside Execute() (worker
// thread), refuses to run against a closed handle, and leaves marshaling
// plain-C results to Napi::Value for the subclass's ToJs() - which runs in
// OnOK() on the main thread, since Napi types must never be touched off it.
//
// Subclasses capture only raw pointers/plain-C members in their constructor
// (main thread) - never a Napi::ObjectWrap<Handle>& or Napi::Reference - so
// nothing Napi-typed is touched off the main thread, and GC-deferred
// finalizer teardown of Handle can't leave a worker holding a stale JS ref.
template <typename Result>
class HandleWorker : public Napi::AsyncWorker {
 public:
  HandleWorker(Napi::Env env, Handle* h)
      : Napi::AsyncWorker(env),
        deferred_(Napi::Promise::Deferred::New(env)),
        mutex_(&h->mutex_),
        open_flag_(&h->open_),
        alpm_(&h->alpm_) {}

  Napi::Promise Promise() { return deferred_.Promise(); }

 protected:
  void Execute() final {
    std::lock_guard<std::mutex> lock(*mutex_);
    if (!*open_flag_) {
      SetError("handle is closed");
      return;
    }
    RunAlpm(*alpm_);
  }

  // Subclass: libalpm calls only, filling result_ with plain C++ types.
  virtual void RunAlpm(alpm_handle_t* alpm) = 0;

  // Prefer this over the bare SetError(string) when a real alpm_errno_t is
  // available, so the rejected Error carries `.code` for src/core/errors.ts
  // to map - same as MakeAlpmError, just reachable from RunAlpm().
  void SetAlpmError(alpm_errno_t err) {
    alpm_err_ = err;
    SetError(alpm_strerror(err));
  }

  void OnOK() final { deferred_.Resolve(result_.ToJs(Env())); }

  void OnError(const Napi::Error& e) final {
    deferred_.Reject(alpm_err_ == ALPM_ERR_OK ? e.Value() : MakeAlpmError(Env(), alpm_err_).Value());
  }

  Napi::Promise::Deferred deferred_;
  std::mutex* mutex_;
  bool* open_flag_;
  alpm_handle_t** alpm_;
  Result result_;
  alpm_errno_t alpm_err_ = ALPM_ERR_OK;
};
