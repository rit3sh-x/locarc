.PHONY: install prebuild debug release clean dev lint format deploy build-apk

APK_SRC  := android/app/build/outputs/apk/release/app-release.apk
APK_DEST := dist/locarc.apk

install:
	pnpm install

prebuild:
	pnpm run prebuild:android --clean

debug:
	pnpm run android

build-apk:
	cd android && ./gradlew assembleRelease --no-daemon --build-cache
	@mkdir -p dist
	@if [ -f "$(APK_SRC)" ]; then \
		cp "$(APK_SRC)" "$(APK_DEST)"; \
	else \
		echo "Release APK not found in android/app/build/outputs/apk/release"; \
		exit 1; \
	fi
	@echo "APK ready: $(APK_DEST)"

release: build-apk

deploy: prebuild build-apk
	@echo "✓ Full deploy complete — APK at $(APK_DEST)"

clean:
	rm -rf android/app/.cxx android/app/build android/build modules/native/android/build
	rm -rf android/.gradle

dev:
	pnpm run dev

lint:
	pnpm run lint

format:
	pnpm run format