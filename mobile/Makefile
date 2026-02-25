.PHONY: install prebuild debug release clean dev lint format

install:
	npm install

prebuild:
	npm run prebuild:android

debug:
	npm run android

release:
	cd android && ./gradlew assembleRelease --no-daemon

clean:
	rm -rf android/app/.cxx android/app/build android/build modules/native/android/build

dev:
	npm run dev:android

lint:
	npm run lint

format:
	npm run format