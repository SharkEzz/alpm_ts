#include "handle.h"

Napi::Function Handle::GetClass(Napi::Env env) {
  return DefineClass(env, "Handle",
                      {
                          Handle::InstanceMethod("open", &Handle::Open),
                          Handle::InstanceMethod("close", &Handle::Close),
                          Handle::InstanceMethod("options", &Handle::Options),
                          Handle::InstanceMethod("listPackages", &Handle::ListPackages),
                          Handle::InstanceMethod("getPackage", &Handle::GetPackage),
                          Handle::InstanceMethod("search", &Handle::Search),
                          Handle::InstanceMethod("registerSyncDb", &Handle::RegisterSyncDb),
                          Handle::InstanceMethod("setArchitectures", &Handle::SetArchitectures),
                          Handle::InstanceMethod("addIgnorePkg", &Handle::AddIgnorePkg),
                          Handle::InstanceMethod("owners", &Handle::Owners),
                          Handle::InstanceMethod("requiredBy", &Handle::RequiredBy),
                          Handle::InstanceMethod("optionalFor", &Handle::OptionalFor),
                          Handle::InstanceMethod("groups", &Handle::Groups),
                          Handle::InstanceMethod("newVersion", &Handle::NewVersion),
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
