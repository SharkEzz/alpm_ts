#include "marshal.h"

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
