{
  "targets": [
    {
      "target_name": "alpm",
      "sources": [
        "src/addon.cc",
        "src/handle.cc",
        "src/marshal.cc",
        "src/workers.cc"
      ],
      "cflags": ["<!@(pkg-config --cflags libalpm)"],
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "cflags_cc": ["-std=c++17"],
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
      "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
      "libraries": ["<!@(pkg-config --libs libalpm)"],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS",
        "ALPM_BUILD_VERSION=\"<!@(pkg-config --modversion libalpm)\""
      ]
    }
  ]
}
