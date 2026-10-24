# Lumina OS — host build (clean-room, zero third-party dependencies).
#   make            build ./build/lumina
#   make run        render the screenshot tour into ./out
#   make preview    live desktop on http://0.0.0.0:8080
#   make test       run the core test suite
#   make kernel     build the Rust kernel + bootable disk image (rustup targets)
CXX      ?= g++
CXXFLAGS ?= -std=c++17 -O2 -g -Wall -Wextra -Wpedantic -Iinclude
LDLIBS   ?= -pthread
BUILD    := build

CORE := src/compositor/surface.cpp src/compositor/theme.cpp src/compositor/compositor.cpp \
        src/shell/apps.cpp src/shell/shell.cpp
HOST := host/main.cpp host/png.cpp
OBJ  := $(patsubst %.cpp,$(BUILD)/%.o,$(CORE) $(HOST))

.PHONY: all run preview test clean kernel fmt

all: $(BUILD)/lumina

$(BUILD)/lumina: $(OBJ)
	$(CXX) $(CXXFLAGS) -o $@ $^ $(LDLIBS)

$(BUILD)/%.o: %.cpp
	@mkdir -p $(dir $@)
	$(CXX) $(CXXFLAGS) -MMD -MP -c -o $@ $<

$(BUILD)/test_core: $(patsubst %.cpp,$(BUILD)/%.o,$(CORE)) $(BUILD)/tests/test_core.o
	$(CXX) $(CXXFLAGS) -o $@ $^ $(LDLIBS)

run: $(BUILD)/lumina
	./$(BUILD)/lumina --scenario tour --root ..

preview: $(BUILD)/lumina
	./$(BUILD)/lumina --scenario serve --port $${PORT:-8080} --root ..

test: $(BUILD)/test_core
	./$(BUILD)/test_core

# Kernel + bootloader are freestanding Rust; see kernel/README.md.
kernel:
	./kernel/build.sh

clean:
	rm -rf $(BUILD) out kernel/target kernel/bootloader/target kernel/app/target kernel/build

-include $(OBJ:.o=.d)
