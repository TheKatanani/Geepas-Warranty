import { describe, it, expect, beforeEach, vi } from "vitest";
import { loader, action } from "../routes/get-in-touch";

describe("/get-in-touch route", () => {
  beforeEach(() => {
    process.env.WEBSITE_URL = "https://www.geepas.com.iq/";
  });

  it("loader redirects to website contact-us page", async () => {
    const response = await loader({
      request: new Request("http://localhost/get-in-touch"),
      params: {},
      context: {},
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://www.geepas.com.iq/pages/contact-us");
  });

  it("action redirects to website contact-us page", async () => {
    const response = await action({
      request: new Request("http://localhost/get-in-touch", { method: "POST" }),
      params: {},
      context: {},
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://www.geepas.com.iq/pages/contact-us");
  });

  it("uses fallback domain if WEBSITE_URL is empty", async () => {
    delete process.env.WEBSITE_URL;

    const response = await loader({
      request: new Request("http://localhost/get-in-touch"),
      params: {},
      context: {},
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://www.geepas.com.iq/pages/contact-us");
  });
});
