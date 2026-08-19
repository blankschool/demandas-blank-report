import assert from "node:assert/strict";
import test from "node:test";

async function worker(suffix) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${suffix}`);
  return (await import(workerUrl.href)).default;
}

const environment = {
  ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
};
const context = { waitUntil() {}, passThroughOnException() {} };

test("renderiza a aplicação final em português", async () => {
  const response = await (await worker("home")).fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }), environment, context,
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<html lang="pt-BR"/i);
  assert.match(html, /<title>Operação Criativa · Blank School<\/title>/i);
  assert.match(html, /Carregando/);
  assert.doesNotMatch(html, /Your site is taking shape|react-loading-skeleton|codex-preview/i);
});

test("protege a API de demandas sem sessão", async () => {
  const response = await (await worker("api")).fetch(
    new Request("http://localhost/api/demandas"), environment, context,
  );
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Não autorizado" });
});
