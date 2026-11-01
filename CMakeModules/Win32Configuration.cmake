set(INSTALL_BIN_DIR .)
set(INSTALL_RESOURCE_DIR .)
set(HAVE_UPDATER 1)

find_path(VCRUNTIME_DIR vcruntime140.dll
  PATHS "${CMAKE_SOURCE_DIR}/dev/windows/deps/vcruntime" "${CMAKE_SOURCE_DIR}/deps/vcruntime"
  NO_DEFAULT_PATH
  DOC "Directory containing the redistributable MSVC runtime DLLs")

find_library(WINMM winmm)
find_library(IMMLIB imm32)
find_library(VERLIB version)
find_library(DWMLIB dwmapi)
find_library(AVRTLIB avrt)
find_library(POWRPROFLIB PowrProf)
find_library(RUNTIMEOBJECTLIB RuntimeObject)
set(OS_LIBS ${WINMM} ${IMMLIB} ${VERLIB} ${DWMLIB} ${AVRTLIB} ${POWRPROFLIB} ${RUNTIMEOBJECTLIB})
