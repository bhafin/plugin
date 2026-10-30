import test from "node:test";
import assert from "node:assert/strict";
import { Bharosa, BharosaMarket } from "bharosa";

test("published SDK defaults and overrides preserve account and registered-app namespaces without network access", async () => {
  for (const baseUrl of [undefined, "https://synthetic.invalid"]) {
    for (const market of [false, true]) {
      const calls = [];
      const fetch = async (url, init) => {
        calls.push({ url: String(url), init });
        throw new Error("synthetic transport stops before network");
      };
      const config = { fetch, ...(baseUrl ? { baseUrl } : {}) };
      const client = market
        ? new BharosaMarket({ ...config, apiKey: "synthetic-market-key" })
        : new Bharosa({
            ...config,
            account: "me",
            auth: { type: "account_key", apiKey: "synthetic-account-key" },
          });
      await assert.rejects(() =>
        market
          ? client.schemes.nav("101", { asOf: "2026-08-01" })
          : client.accounts.retrieve(),
      );
      assert.equal(calls.length, 1);
      const url = new URL(calls[0].url);
      assert.equal(url.origin, baseUrl ?? "https://api.bharosa.finance");
      assert.ok(
        url.pathname.startsWith(market ? "/v1/market-data/" : "/v1/accounts/"),
      );
      assert.equal(
        calls[0].init.headers.Authorization,
        `Bearer synthetic-${market ? "market" : "account"}-key`,
      );
      assert.equal(
        calls[0].init.headers["Bharosa-User-Authorization"],
        undefined,
      );
    }
  }
  for (const baseUrl of [
    "",
    null,
    "http://unsafe.invalid",
    "https://api.bharosa.finance/path",
  ]) {
    assert.throws(
      () => new BharosaMarket({ baseUrl, apiKey: "synthetic-key" }),
    );
    assert.throws(
      () =>
        new Bharosa({
          baseUrl,
          account: "me",
          auth: { type: "account_key", apiKey: "synthetic-key" },
        }),
    );
  }
});
