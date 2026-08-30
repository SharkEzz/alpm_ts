#include <napi.h>
#include <alpm.h>

#include <cstdlib>
#include <sstream>
#include <string>

#include "handle.h"

namespace {

int MajorVersion(const std::string& version) {
  auto dot = version.find('.');
  std::string major = dot == std::string::npos ? version : version.substr(0, dot);
  return std::atoi(major.c_str());
}

void CheckVersion(Napi::Env env) {
  const std::string build_version = ALPM_BUILD_VERSION;
  const std::string runtime_version = alpm_version();
  if (MajorVersion(build_version) != MajorVersion(runtime_version)) {
    std::ostringstream msg;
    msg << "alpm-ts native addon was built against libalpm " << build_version
        << " but the runtime library is " << runtime_version
        << " (soname/major mismatch) - rebuild the addon: npm rebuild alpm-ts";
    Napi::Error::New(env, msg.str()).ThrowAsJavaScriptException();
  }
}

Napi::Value Version(const Napi::CallbackInfo& info) {
  return Napi::String::New(info.Env(), alpm_version());
}

Napi::Value Capabilities(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  int caps = alpm_capabilities();
  Napi::Object result = Napi::Object::New(env);
  result.Set("nls", Napi::Boolean::New(env, caps & ALPM_CAPABILITY_NLS));
  result.Set("downloader", Napi::Boolean::New(env, caps & ALPM_CAPABILITY_DOWNLOADER));
  result.Set("signatures", Napi::Boolean::New(env, caps & ALPM_CAPABILITY_SIGNATURES));
  return result;
}

Napi::Value Vercmp(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
    Napi::TypeError::New(env, "vercmp(a, b) expects two strings").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  std::string a = info[0].As<Napi::String>();
  std::string b = info[1].As<Napi::String>();
  return Napi::Number::New(env, alpm_pkg_vercmp(a.c_str(), b.c_str()));
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  CheckVersion(env);
  if (env.IsExceptionPending()) {
    return exports;
  }

  exports.Set("version", Napi::Function::New(env, Version));
  exports.Set("capabilities", Napi::Function::New(env, Capabilities));
  exports.Set("vercmp", Napi::Function::New(env, Vercmp));
  exports.Set("Handle", Handle::GetClass(env));
  return exports;
}

}  // namespace

NODE_API_MODULE(alpm, Init)
