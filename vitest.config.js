import { fileURLToPath } from "node:url";
import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";
import { configDefaults } from "vitest/config";

export default defineWorkersConfig(async () => {
	// Exposed to tests so D1 migrations can be exercised against local D1.
	const migrations = await readD1Migrations(fileURLToPath(new URL("./migrations", import.meta.url)));
	return {
		test: {
			// Bridge packages under ops/ ship their own node:test suites (node:sqlite,
			// node:http) and must not run inside the Workers pool.
			exclude: [...configDefaults.exclude, "ops/**"],
			poolOptions: {
				workers: {
					wrangler: { configPath: "./wrangler.jsonc" },
					// Tests run against local fakes only; never open a remote proxy
					// session for Workers AI, D1 or R2 bindings.
					remoteBindings: false,
					miniflare: {
						bindings: { TEST_MIGRATIONS: migrations },
					},
				},
			},
		},
	};
});
