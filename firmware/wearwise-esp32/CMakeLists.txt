cmake_minimum_required(VERSION 3.16)

# WearWise sensor patch firmware — ESP-WROOM-32, ESP-IDF v5.4.
# One project, one target. `idf.py set-target esp32` once, then `idf.py build flash monitor`.

# The app image's version (esp_app_desc, which the patch-setup page reads back) is
# WW_FW_VERSION — one source of truth instead of `git describe`.
file(STRINGS "${CMAKE_CURRENT_LIST_DIR}/main/config/FirmwareConfig.h" _ww_ver REGEX "^#define WW_FW_VERSION ")
string(REGEX REPLACE ".*\"(.*)\".*" "\\1" PROJECT_VER "${_ww_ver}")

include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(wearwise-esp32)
