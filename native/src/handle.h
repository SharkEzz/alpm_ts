#pragma once

#include <napi.h>
#include <alpm.h>

#include <mutex>

// Wraps a single alpm_handle_t*. libalpm handles are not thread-safe, so
// every call into libalpm through this handle must hold `mutex_` - and must
// take it only from AsyncWorker::Execute() (the libuv threadpool), never
// from the main thread. `open_` is guarded by the same mutex and lets a
// query worker fail cleanly if it races a close() instead of touching a
// freed alpm_handle_t*.
class Handle : public Napi::ObjectWrap<Handle> {
 public:
  static Napi::Function GetClass(Napi::Env env);
  explicit Handle(const Napi::CallbackInfo& info);
  ~Handle();

  Napi::Value Open(const Napi::CallbackInfo& info);
  Napi::Value Close(const Napi::CallbackInfo& info);
  Napi::Value Options(const Napi::CallbackInfo& info);
  Napi::Value ListPackages(const Napi::CallbackInfo& info);
  Napi::Value GetPackage(const Napi::CallbackInfo& info);
  Napi::Value Search(const Napi::CallbackInfo& info);
  Napi::Value RegisterSyncDb(const Napi::CallbackInfo& info);
  Napi::Value SetArchitectures(const Napi::CallbackInfo& info);
  Napi::Value AddIgnorePkg(const Napi::CallbackInfo& info);
  Napi::Value Owners(const Napi::CallbackInfo& info);
  Napi::Value RequiredBy(const Napi::CallbackInfo& info);
  Napi::Value OptionalFor(const Napi::CallbackInfo& info);
  Napi::Value Groups(const Napi::CallbackInfo& info);
  Napi::Value NewVersion(const Napi::CallbackInfo& info);

  alpm_handle_t* alpm_ = nullptr;
  std::mutex mutex_;
  bool open_ = false;
};
