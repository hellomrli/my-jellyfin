cmake_minimum_required(VERSION 3.10...3.31)

set(CMAKE_AUTOMOC ON)

find_package(Qt6 ${REQUIRED_QT_VERSION} REQUIRED COMPONENTS Test)

set(TEST_INCLUDE_DIRS
  ${CMAKE_SOURCE_DIR}/src
  ${CMAKE_SOURCE_DIR}/src/core
  ${CMAKE_SOURCE_DIR}/src/shared
  ${CMAKE_SOURCE_DIR}/external
  ${CMAKE_SOURCE_DIR}/src/player
)

set(TEST_COMPILE_DEFS
  PREFIX="${CMAKE_INSTALL_PREFIX}"
)

add_executable(test_systemcomponent test_systemcomponent.cpp)
target_link_libraries(test_systemcomponent jmp_core Qt6::Test)
target_include_directories(test_systemcomponent PRIVATE ${TEST_INCLUDE_DIRS})
target_compile_definitions(test_systemcomponent PRIVATE ${TEST_COMPILE_DEFS})
add_test(NAME test_systemcomponent COMMAND test_systemcomponent)

add_executable(test_log test_log.cpp)
target_link_libraries(test_log jmp_core Qt6::Test)
target_include_directories(test_log PRIVATE ${TEST_INCLUDE_DIRS})
target_compile_definitions(test_log PRIVATE ${TEST_COMPILE_DEFS})
add_test(NAME test_log COMMAND test_log)

add_executable(test_settings test_settings.cpp)
target_link_libraries(test_settings jmp_core Qt6::Test)
target_include_directories(test_settings PRIVATE ${TEST_INCLUDE_DIRS})
target_compile_definitions(test_settings PRIVATE ${TEST_COMPILE_DEFS})
add_test(NAME test_settings COMMAND test_settings)

add_executable(test_displaymanager test_displaymanager.cpp)
target_link_libraries(test_displaymanager jmp_core Qt6::Test)
target_include_directories(test_displaymanager PRIVATE ${TEST_INCLUDE_DIRS})
target_compile_definitions(test_displaymanager PRIVATE ${TEST_COMPILE_DEFS})
add_test(NAME test_displaymanager COMMAND test_displaymanager)

foreach(TEST_NAME windowmanager chromiumflags)
  add_executable(test_${TEST_NAME} test_${TEST_NAME}.cpp)
  target_link_libraries(test_${TEST_NAME} jmp_core Qt6::Test)
  target_include_directories(test_${TEST_NAME} PRIVATE ${TEST_INCLUDE_DIRS})
  target_compile_definitions(test_${TEST_NAME} PRIVATE ${TEST_COMPILE_DEFS})
  add_test(NAME test_${TEST_NAME} COMMAND test_${TEST_NAME})
endforeach()
set_tests_properties(test_windowmanager PROPERTIES ENVIRONMENT "QT_QPA_PLATFORM=offscreen")

if(USE_STATIC_MPVQT)
  foreach(TEST_NAME mpvcontroller mpvabstractitem)
    add_executable(test_${TEST_NAME} test_${TEST_NAME}.cpp)
    target_link_libraries(test_${TEST_NAME} MpvQt Qt6::Test)
    add_test(NAME test_${TEST_NAME} COMMAND test_${TEST_NAME})
  endforeach()
  set_tests_properties(test_mpvabstractitem PROPERTIES ENVIRONMENT "QT_QPA_PLATFORM=offscreen")
endif()

option(REQUIRE_NODE_TESTS "Fail configuration if Node.js playback tests cannot run" OFF)
find_program(NODE_EXECUTABLE NAMES node nodejs)
if(NODE_EXECUTABLE)
  execute_process(COMMAND ${NODE_EXECUTABLE} -p "Number(process.versions.node.split('.')[0]) >= 18"
                  OUTPUT_VARIABLE NODE_SUPPORTED OUTPUT_STRIP_TRAILING_WHITESPACE)
endif()
if(NODE_SUPPORTED STREQUAL "true")
  add_test(NAME test_mpvPlayers COMMAND ${NODE_EXECUTABLE} --test ${CMAKE_CURRENT_SOURCE_DIR}/test_mpvPlayers.js)
elseif(REQUIRE_NODE_TESTS)
  message(FATAL_ERROR "Node.js 18+ is required for the JavaScript playback regression tests")
else()
  message(WARNING "Node.js 18+ not found; JavaScript playback tests will not run")
endif()
