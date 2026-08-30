#include "handle.h"

Napi::Function Handle::GetClass(Napi::Env env) {
  return DefineClass(env, "Handle",
                      {
                          Handle::InstanceMethod("open", &Handle::Open),
                          Handle::InstanceMethod("close", &Handle::Close),
                          Handle::InstanceMethod("options", &Handle::Options),
                      });
}

Handle::Handle(const Napi::CallbackInfo& info) : Napi::ObjectWrap<Handle>(info) {}

Handle::~Handle() {
  // Defensive fallback if close() was never awaited before GC: alpm_release
  // synchronously on the main thread rather than leaking the handle. Normal
  // usage should always go through close().
  if (open_ && alpm_ != nullptr) {
    alpm_release(alpm_);
    alpm_ = nullptr;
    open_ = false;
  }
}
