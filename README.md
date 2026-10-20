# Locarc

LocArc uses phones as SDR receivers to measure signal power, Convex to localize transmitters, and a website for operators to manage the system. See [CONTEXT.md](CONTEXT.md) for definitions of the terms used throughout the project.

## Project Structure

- `convex/` : Backend schema, functions, scheduled jobs, and shared modules.
- `convex/lib/wire/` : Golden files defining the wire protocol. Both TypeScript and Kotlin tests use these files to keep the phone and backend implementations in sync.
- `src/` : Operator website, built with React, TanStack Router, Tailwind CSS, Base UI, and MapLibre.
- `worker/` : Cloudflare Worker that proxies `/api/auth/*` requests to Convex. Other requests are served as static assets, configured through `wrangler.jsonc` and `public/_headers`.
- `scripts/` : Development setup, Receiver simulator, and release publishing tools.
- `e2e/` : Playwright end-to-end tests that run against a temporary Convex backend.
- `android/` : Android Receiver application:
    - `core/` : Pure Kotlin implementation of DSP, codecs, the upload outbox, synchronization, and the Receiver engine. Tested on the JVM.
    - `app/` : Android application shell.

## Getting Started

**Requirements:** Bun 1.4.3 or newer.

```sh
bun install
cp .env.example .env.local   # the one env file: your Organization and first Operator
bun run setup             # creates a dev deployment, its secrets, the Organization and you
bun run dev               # Convex + the website on http://localhost:5173
```

Before running setup, configure `.env.local` with your Organization details and the initial Operator credentials. It is the project's only env file: Convex adds the deployment's URLs to it, and setup adds the dev deployment's secrets.

`bun run setup` creates a development deployment, configures its secrets, creates the Organization and initial Operator, and enables the Git pre-push hook. The secrets are saved in `.env.local`, and setup keeps the deployment in step with them: to change one, edit it there and run setup again. On a deployment that is already set up, setup syncs the secrets and functions, then stops with `ALREADY_SET_UP`.

The development server starts Convex and the website at `http://localhost:5173`.

To reset the initial Operator's password to the value configured in `.env.local`, run:

```sh
bun run setup -- --reset-password
```

## Checks and Tests

Run the full verification suite:

```sh
bun run verify
```

This runs Biome, TypeScript type-checking, and all unit and backend tests. The same checks run automatically before each Git push.

Run the end-to-end tests:

```sh
bun run e2e
```

This starts its own Convex backend and Vite server. Stop `bun run dev` before running it.

## Simulated Receivers

Pair simulated Receivers using codes from **Receivers → Pair Receiver** in the website:

```sh
bun run sim -- --pair ABCD-1234 --pair EFGH-5678
```

Replace the example codes with your actual pairing codes. Once paired, subsequent runs resume the existing simulated Receivers:

```sh
bun run sim
```

The default scenario, `scripts/sim/scenarios/demo.json`, places four Receivers and several emitters in Bengaluru. It includes a 20 MHz Wi-Fi network and a bursty emitter.

The simulator follows the same timing model as real phones: each Receiver listens throughout a Scan's window and uploads its measurements just before the next window begins.

## Production Soak Test

Before the first production deployment, run a 24-hour soak test to validate system behavior and resource usage.

1. Configure the simulator to target the deployment under test using `--url`.
2. Pair the scenario's Receivers with that deployment.
3. Start a Run using the intended production scan cadence and record the usage meter's projected consumption.
4. Run the simulator for 24 hours:

    ```sh
    bun run sim -- --soak
    ```

5. Compare the reported pass criteria with the Convex dashboard and investigate any failures or unexpected usage.

## CI and Releases

### Website and Backend

`.github/workflows/web.yml` runs when relevant website, backend, script, or test files change. It runs verification and end-to-end tests. On `main`, it also deploys Convex and the website.

### Android Receiver

`.github/workflows/android.yml` runs when files under `android/` or `convex/lib/wire/` change, on pull requests and on `main`. Nothing Android builds locally.

On every run it:

1. Runs ktlint and the JVM tests.
2. Builds a debug APK and uploads it as the `app-debug` artifact (kept 7 days).

On `main` it also:

3. Builds a signed arm64 release APK.
4. Publishes it as a release candidate using `bun run publish:release`.

The build steps live in `bun run build:android` (`scripts/build-android.ts`); the workflow only installs the toolchain and calls it, so a local build is the same as CI's:

- `bun run build:android` runs ktlint, the JVM tests and a debug APK (`android/app/build/outputs/apk/debug/`). It needs JDK 17 and the Android SDK (`ANDROID_HOME`).
- `bun run build:android release` builds the signed release APK from `LOCARC_KEYSTORE_FILE` (or `LOCARC_KEYSTORE_BASE64`), `LOCARC_KEYSTORE_PASSWORD`, `LOCARC_KEY_ALIAS` and `LOCARC_KEY_PASSWORD`, with `VERSION_CODE`, `VERSION_NAME` and `CONVEX_URL` when set.
- Without a JDK, push your branch (or open a pull request) and take the `app-debug` artifact from that workflow run, on its GitHub page or with `gh run download <run-id> -n app-debug`. The workflow can also be started by hand from the Actions tab.

After completing the hardware checklist, promote the candidate through **Settings → Releases**.

### Wire Protocol Fixtures

When deliberately changing the wire protocol, regenerate the sample sync response with:

```sh
WRITE_WIRE=1 bun test convex/tests/sync.wire.test.ts
```

Review the generated changes before committing them.

## Production Configuration

Configure the following settings in the GitHub Actions `production` environment.

| Type     | Name                       |
| -------- | -------------------------- |
| Secret   | `CONVEX_DEPLOY_KEY`        |
| Secret   | `CLOUDFLARE_API_TOKEN`     |
| Secret   | `CLOUDFLARE_ACCOUNT_ID`    |
| Secret   | `LOCARC_KEYSTORE_BASE64`   |
| Secret   | `LOCARC_KEYSTORE_PASSWORD` |
| Secret   | `LOCARC_KEY_ALIAS`         |
| Secret   | `LOCARC_KEY_PASSWORD`      |
| Variable | `CONVEX_SITE_URL`          |
| Variable | `CONVEX_URL`               |

For a new production deployment, run `bunx convex login`, then run setup once with `LOCARC_SITE_URL` set to the website's origin. It sets production's env vars, deploys the functions and creates the Organization and first Operator. Run it before the first push to `main`, because CI's deploy needs those env vars:

```sh
bun run setup -- --prod
```

Ensure the production environment and required credentials are configured before deploying.
