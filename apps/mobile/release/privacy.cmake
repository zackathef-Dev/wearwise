# Remove local identity from __FILE__/assertion strings as well as debug metadata.
file(TO_CMAKE_PATH "$ENV{USERPROFILE}" WEARWISE_USER_PATH)
get_filename_component(WEARWISE_WORKSPACE "${CMAKE_CURRENT_LIST_DIR}/../../.." ABSOLUTE)
if(WEARWISE_USER_PATH)
  add_compile_options("-ffile-prefix-map=${WEARWISE_USER_PATH}=/build/user")
endif()
add_compile_options("-ffile-prefix-map=${WEARWISE_WORKSPACE}=/build/workspace")
