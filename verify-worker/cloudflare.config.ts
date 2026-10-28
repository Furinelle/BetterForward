import { bindings, defineConfig, exports } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig({
	worker: {
		name: "betterforward-verify",
		compatibilityDate: "2026-09-25",
		entrypoint,
		domains: ["verify.furina.ai"],
		workersDev: false,
		previewUrls: false,
		exports: {
			TokenStore: exports.durableObject({ storage: "sqlite" }),
		},
		env: {
			// A single strongly consistent store: BetterForward polls from another region right after the user solves.
			TOKENS: bindings.durableObject({ worker: "betterforward-verify", exportName: "TokenStore" }),
			TURNSTILE_SITEKEY: bindings.text("0x4AAAAAAFpOEY9sbLOgouaU"),
			TURNSTILE_SECRET: bindings.secret(),
			API_KEY: bindings.secret(),
		},
	},
});
