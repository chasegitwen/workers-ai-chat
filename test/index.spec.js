import { describe, it, expect } from "vitest";
import worker from "../src";

describe("Hello World worker", () => {
	it("serves the application shell", async () => {
		const request = new Request("http://example.com");
		const response = await worker.fetch(request, {}, {});
		const text = await response.text();

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toContain("text/html");
		expect(text.toLowerCase()).toContain("<!doctype html>");
	});
});
