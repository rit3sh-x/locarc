module.exports = {
    apps: [
        {
            name: "locarc-web",
            cwd: "./web",
            script: "node",
            args: "node_modules/next/dist/bin/next start -p 3000",
            env: { NODE_ENV: "production" },
            watch: false,
            max_memory_restart: "350M",
            autorestart: true,
        },
        {
            name: "locarc-api",
            cwd: "./server",
            script: "uv",
            args: "run uvicorn main:app --host 0.0.0.0 --port 8080",
            interpreter: "none",
            env: { ENV: "production" },
            watch: false,
            autorestart: true,
        },
    ],
};