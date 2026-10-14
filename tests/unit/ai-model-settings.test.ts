import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  defaultImageModel, defaultTextModel, loadOpenRouterCatalogs, normalizeImageModels,
  normalizeTextModels, normalizeVisionModels, withTextModel, withUserTextModel, currentTextModel
} from "../../lib/ai-model-settings";
import { decodeOpenRouterImage } from "../../lib/openrouter-image";

const originalKey = process.env.OPENROUTER_API_KEY;
const originalModel = process.env.OPENROUTER_MODEL;
afterEach(() => {
  if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = originalKey;
  if (originalModel === undefined) delete process.env.OPENROUTER_MODEL;
  else process.env.OPENROUTER_MODEL = originalModel;
});

describe("OpenRouter catalog normalization", () => {
  it("keeps all valid text models and exposes structured-output support", () => {
    const models = normalizeTextModels({ data: [
      { id: "openai/gpt-4.1-mini", name: "GPT-4.1 Mini", supported_parameters: ["structured_outputs"] },
      { id: "anthropic/claude", name: "Claude", supported_parameters: ["temperature"] },
      { id: "~openai/gpt-sol-latest", name: "GPT Sol Latest" },
      { id: "not a model", name: "Invalid" }, null
    ] });
    assert.deepEqual(models.map(model => [model.id, model.structuredOutputs]), [
      ["openai/gpt-4.1-mini", true], ["anthropic/claude", false], ["~openai/gpt-sol-latest", false]
    ]);
  });

  it("normalizes image catalog entries and falls back to the model ID for missing names", () => {
    assert.deepEqual(normalizeImageModels({ data: [
      { id: "black-forest-labs/flux.2-pro", name: "Flux 2 Pro", description: "Text to image" },
      { id: "google/imagen-4" }
    ] }), [
      { id: "black-forest-labs/flux.2-pro", name: "Flux 2 Pro", description: "Text to image", supportedAspectRatios: [] },
      { id: "google/imagen-4", name: "google/imagen-4", description: "", supportedAspectRatios: [] }
    ]);
  });

  it("normalizes the live image-input text-model catalog for OCR selection", () => {
    assert.deepEqual(normalizeVisionModels({data:[
      {id:"deepseek/deepseek-v4.1-flash",name:"DeepSeek V4.1 Flash",supported_parameters:["structured_outputs"]},
      {id:"text-only/model",name:"Filtered upstream"}
    ]}),[
      {id:"deepseek/deepseek-v4.1-flash",name:"DeepSeek V4.1 Flash",description:"",structuredOutputs:true},
      {id:"text-only/model",name:"Filtered upstream",description:"",structuredOutputs:false}
    ]);
  });

  it("fetches live text, image-generation, and image-input catalogs", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const urls: string[] = [];
    const catalogs = await loadOpenRouterCatalogs(async (input, init) => {
      urls.push(String(input));
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-key");
      assert.equal(init?.cache, "no-store");
      return new Response(JSON.stringify({ data: [{ id: "org/model", name: "Model" }] }), { status: 200 });
    },async()=>process.env.OPENROUTER_API_KEY||null);
    assert.deepEqual(urls.sort(), [
      "https://openrouter.ai/api/v1/images/models",
      "https://openrouter.ai/api/v1/models?input_modalities=image&output_modalities=text",
      "https://openrouter.ai/api/v1/models?output_modalities=text"
    ]);
    assert.equal(catalogs.textModels[0]?.id, "org/model");
    assert.equal(catalogs.imageModels[0]?.id, "org/model");
    assert.equal(catalogs.visionModels[0]?.id, "org/model");
  });
});

describe("OpenRouter image response", () => {
  it("decodes supported image media types and derives the file extension", () => {
    const decoded = decodeOpenRouterImage({ data: [{
      b64_json: Buffer.from("image-bytes").toString("base64"), media_type: "image/jpeg"
    }] });
    assert.equal(decoded.contentType, "image/jpeg");
    assert.equal(decoded.extension, "jpg");
    assert.equal(decoded.binary.toString(), "image-bytes");
  });

  it("rejects unknown formats, malformed base64, and oversized images", () => {
    assert.throws(() => decodeOpenRouterImage({ data: [{ b64_json: "aGVsbG8=", media_type: "image/gif" }] }), /formato/);
    assert.throws(() => decodeOpenRouterImage({ data: [{ b64_json: "bad!", media_type: "image/png" }] }), /validi/);
    const oversized = Buffer.alloc(15_000_001).toString("base64");
    assert.throws(() => decodeOpenRouterImage({ data: [{ b64_json: oversized, media_type: "image/png" }] }), /troppo grande/);
  });
});

describe("text model selection", () => {
  it("uses the selected workspace model, then environment, then the current default", async () => {
    process.env.OPENROUTER_MODEL = "fallback/model";
    assert.equal(defaultTextModel(), "fallback/model");
    await withTextModel("user/model", async () => {
      assert.equal(currentTextModel(), "user/model");
      await withTextModel("nested/model", async () => assert.equal(currentTextModel(), "nested/model"));
      assert.equal(currentTextModel(), "user/model");
    });
    assert.equal(currentTextModel(), "fallback/model");
    process.env.OPENROUTER_MODEL = "openai/gpt-4.1-mini";
    assert.equal(defaultTextModel(), "~deepseek/deepseek-flash-latest");
    delete process.env.OPENROUTER_MODEL;
    assert.equal(defaultTextModel(), "~deepseek/deepseek-flash-latest");
    assert.equal(defaultImageModel(), "openai/gpt-image-2.5-sunburst");
  });

  it("restores the prior model after a rejected request", async () => {
    await assert.rejects(withTextModel("temporary/model", async () => {
      assert.equal(currentTextModel(), "temporary/model");
      throw new Error("provider failed");
    }), /provider failed/);
    assert.equal(currentTextModel(), "~deepseek/deepseek-flash-latest");
  });

  it("loads the local owner's saved model before entering the request scope", async () => {
    let requestedUser = "";
    await withUserTextModel("user-a", async () => {
      assert.equal(currentTextModel(), "saved/model-a");
    }, async userId => {
      requestedUser = userId;
      return "saved/model-a";
    });
    assert.equal(requestedUser, "user-a");
  });
});
