#pragma once

#include <napi.h>
#include <alpm.h>

#include <string>
#include <vector>

// Deep-copies a borrowed alpm_list_t of char* (e.g. alpm_option_get_cachedirs,
// alpm_option_get_architectures) into owned std::strings. Must run in
// Execute(), before any alpm_release/alpm_list_free could invalidate the
// underlying char*s. Does not free `list` - these getters return
// handle-owned lists.
std::vector<std::string> CopyStringList(alpm_list_t* list);

Napi::Array StringsToJs(Napi::Env env, const std::vector<std::string>& strings);
