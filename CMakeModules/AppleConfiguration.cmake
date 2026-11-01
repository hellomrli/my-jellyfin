get_target_property(_qt_macos_minimum Qt6::Core QT_DARWIN_MIN_DEPLOYMENT_TARGET)
if(NOT _qt_macos_minimum)
  set(_qt_macos_minimum "10.15")
endif()
if(QT_SUPPORTED_MIN_MACOS_VERSION AND _qt_macos_minimum VERSION_LESS QT_SUPPORTED_MIN_MACOS_VERSION)
  set(_qt_macos_minimum "${QT_SUPPORTED_MIN_MACOS_VERSION}")
endif()

# Keep compiler flags and Info.plist consistent with the selected Qt binaries.
if(NOT CMAKE_OSX_DEPLOYMENT_TARGET)
  set(CMAKE_OSX_DEPLOYMENT_TARGET "${_qt_macos_minimum}" CACHE STRING "Minimum macOS version" FORCE)
elseif(CMAKE_OSX_DEPLOYMENT_TARGET VERSION_LESS _qt_macos_minimum)
  message(FATAL_ERROR
    "Qt ${Qt6Core_VERSION} requires macOS ${_qt_macos_minimum} or newer. "
    "Set CMAKE_OSX_DEPLOYMENT_TARGET accordingly or use an older Qt kit.")
endif()
message(STATUS "macOS deployment target: ${CMAKE_OSX_DEPLOYMENT_TARGET}")

find_library(FOUNDATION Foundation)
find_library(APPKIT AppKit)
find_library(IOKIT IOKit)
find_library(COCOA Cocoa)
find_Library(CARBON Carbon)
find_library(SECURITY Security)
find_library(MEDIAPLAYER MediaPlayer)

set(OS_LIBS ${FOUNDATION} ${APPKIT} ${IOKIT} ${COCOA} ${SECURITY} ${CARBON} hidremote letsmove)
set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} -framework MediaPlayer")
set(WARNINGS "-Wall")

set(HAVE_UPDATER 1)
find_program(UPDATER_PATH updater HINTS ${CMAKE_FIND_ROOT_PATH}/update_installer/ NO_DEFAULT_PATH)
if(${UPDATER_PATH} MATCHES "UPDATER_PATH-NOTFOUND")
  set(HAVE_UPDATER 0)
  message(STATUS "will build without the updater")
endif(${UPDATER_PATH} MATCHES "UPDATER_PATH-NOTFOUND")

set(INSTALL_BIN_DIR .)
set(INSTALL_RESOURCE_DIR Resources)
