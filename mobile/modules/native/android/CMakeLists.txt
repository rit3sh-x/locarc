cmake_minimum_required(VERSION 3.22.1)
project(locarc_hackrf C CXX)

set(CMAKE_C_STANDARD 11)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

set(CPP_DIR ${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp)
set(LIBUSB_DIR ${CPP_DIR}/deps/libusb)
set(LIBHACKRF_DIR ${CPP_DIR}/deps/libhackrf)
set(KISSFFT_DIR ${CPP_DIR}/deps/kissfft)

add_library(usb1.0 STATIC
    ${LIBUSB_DIR}/core.c
    ${LIBUSB_DIR}/descriptor.c
    ${LIBUSB_DIR}/hotplug.c
    ${LIBUSB_DIR}/io.c
    ${LIBUSB_DIR}/sync.c
    ${LIBUSB_DIR}/strerror.c
    ${LIBUSB_DIR}/os/events_posix.c
    ${LIBUSB_DIR}/os/threads_posix.c
    ${LIBUSB_DIR}/os/linux_usbfs.c
    ${LIBUSB_DIR}/os/linux_netlink.c
)
target_include_directories(usb1.0 PUBLIC
    ${LIBUSB_DIR}
    ${LIBUSB_DIR}/os
)

target_include_directories(usb1.0 PRIVATE ${LIBUSB_DIR})
target_compile_options(usb1.0 PRIVATE -fvisibility=hidden -pthread -Wno-error)
target_compile_definitions(usb1.0 PRIVATE _GNU_SOURCE HAVE_CONFIG_H)
target_link_libraries(usb1.0 PRIVATE log)

add_library(hackrf STATIC
    ${LIBHACKRF_DIR}/hackrf.c
)
target_include_directories(hackrf PUBLIC ${LIBHACKRF_DIR})
target_link_libraries(hackrf PUBLIC usb1.0)
target_compile_definitions(hackrf PRIVATE LIBRARY_VERSION="2024.02.1" LIBRARY_RELEASE="git")

add_library(kissfft STATIC
    ${KISSFFT_DIR}/kiss_fft.c
)
target_include_directories(kissfft PUBLIC ${KISSFFT_DIR})
target_compile_definitions(kissfft PUBLIC kiss_fft_scalar=double)

add_library(locarc_hackrf SHARED
    ${CPP_DIR}/hackrf_jni.cpp
    ${CPP_DIR}/driver.cpp
    ${CPP_DIR}/dsp.cpp
    ${CPP_DIR}/spectrum.cpp
    ${CPP_DIR}/scan.cpp
    ${CPP_DIR}/algo_config.cpp
)
target_include_directories(locarc_hackrf PRIVATE ${CPP_DIR})
target_link_libraries(locarc_hackrf PRIVATE hackrf usb1.0 kissfft log)
