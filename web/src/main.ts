import { mount } from "svelte";
import App from "./App.svelte";
import { device } from "./state/device.svelte.ts";
import "./theme.css";

const app = mount(App, { target: document.getElementById("app")! });
(globalThis as Record<string, unknown>).device = device; // console handle for hardware debugging
void device.autoConnect(); // bind an already-granted device on load (no prompt), and future plug-ins
export default app;
