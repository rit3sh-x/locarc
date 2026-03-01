.PHONY: install prebuild debug release clean dev lint format deploy build-apk

APK_SRC  := android/app/build/outputs/apk/release/app-release.apk
APK_DEST := android/app/build/outputs/apk/release/locarc.apk

install:
	npm install

prebuild:
	npm run prebuild:android

debug:
	npm run android

build-apk:
	cd android && ./gradlew assembleRelease --no-daemon --build-cache
	@if [ -f "$(APK_SRC)" ]; then mv $(APK_SRC) $(APK_DEST); fi
	@echo "✓ APK ready: $(APK_DEST)"

release: build-apk

deploy: install prebuild build-apk
	@echo "✓ Full deploy complete — APK at $(APK_DEST)"

clean:
	rm -rf android/app/.cxx android/app/build android/build modules/native/android/build
	rm -rf android/.gradle

dev:
	npm run dev:android

lint:
	npm run lint

format:
	npm run format