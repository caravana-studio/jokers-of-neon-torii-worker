import { configuredServices, superviseServices } from "./serviceProcesses.js";

const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
const services = superviseServices(configuredServices(process.env).map(file => new URL(`${file}.${extension}`, import.meta.url)));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { void services.stop(); });
