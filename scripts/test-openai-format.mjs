// OpenAI 格式适配的离线契约测试:mock OpenAI 端点,验证
//  1) resolveModel 三种 apiFormat 的模型构造
//  2) openai-compat provider 真实发起 chat/completions 流式请求(SSE),工具调用完整回收
//  3) openaiPassthrough 无图透传:anthropic 请求 → openai 上游 → anthropic 形状回包
// 跑:node scripts/test-openai-format.mjs
import http from "node:http";
import { resolveModel, models } from "../src/bridge.mjs";
import { openaiPassthrough } from "../src/server.mjs";

let failures = 0;
const ok = (cond, name, extra = "") => {
  console.log(`${cond ? "✓" : "✗ FAIL"} ${name}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
};

// ---------- mock OpenAI 端点 ----------
const seen = { completions: [], responses: [] };
const SSE_TOOLCALL = [
  `data: {"id":"chatcmpl-mock","object":"chat.completion.chunk","created":1,"model":"mock-model","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"submit_board","arguments":""}}]}}]}`,
  `data: {"id":"chatcmpl-mock","object":"chat.completion.chunk","created":1,"model":"mock-model","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"intent\\":\\"hint\\",\\"message\\":\\"mock ok\\",\\"commands\\":[]}"}}]}}]}`,
  `data: {"id":"chatcmpl-mock","object":"chat.completion.chunk","created":1,"model":"mock-model","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":11,"completion_tokens":7}}`,
  `data: [DONE]`,
  "",
].join("\n\n");

const mock = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : {};
    if (req.url === "/v1/models") {
      ok(req.headers.authorization === "Bearer mock-key", "fetch-models 带 Bearer 头");
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ data: [{ id: "mock-model" }, { id: "mock-vision", context_length: 128000 }] }));
    }
    if (req.url === "/v1/chat/completions") {
      seen.completions.push({ headers: req.headers, body });
      if (body.stream) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        return res.end(SSE_TOOLCALL);
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({
        id: "chatcmpl-mock", object: "chat.completion", model: body.model,
        choices: [{ index: 0, message: { role: "assistant", content: "pong from openai" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 5, completion_tokens: 3 },
      }));
    }
    if (req.url === "/v1/responses") {
      seen.responses.push({ headers: req.headers, body });
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({
        id: "resp_mock", model: body.model,
        output: [{ type: "message", content: [{ type: "output_text", text: "pong from responses" }] }],
        usage: { input_tokens: 6, output_tokens: 4 },
      }));
    }
    res.writeHead(404); res.end("nope");
  });
});

await new Promise((r) => mock.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${mock.address().port}`;
console.log(`mock 端点: ${base}\n`);

// ---------- 1) resolveModel ----------
const mOai = resolveModel({ apiFormat: "openai", apiUrl: base, model: "mock-model" }, []);
ok(mOai?.provider === "openai-compat" && mOai?.api === "openai-completions", "openai 模板路由", JSON.stringify({ p: mOai?.provider, api: mOai?.api }));
const mResp = resolveModel({ apiFormat: "openai-responses", apiUrl: base, model: "custom-x" }, []);
ok(mResp?.provider === "openai" && mResp?.api === "openai-responses", "responses 模板路由");
const mAnth = resolveModel({ apiUrl: base, model: "k3" }, []); // 无 apiFormat = 老配置
ok(mAnth?.provider === "kimi-coding" && mAnth?.api === "anthropic-messages", "老配置默认 anthropic 兼容");

// ---------- 2) openai-compat provider 流式 + 工具调用 ----------
const submitTool = {
  name: "submit_board",
  description: "提交板书",
  parameters: { type: "object", properties: { intent: { type: "string" } }, required: ["intent"] },
};
const stream = models.streamSimple(mOai, {
  systemPrompt: "test",
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 }],
  tools: [submitTool],
}, { apiKey: "mock-key" });
const result = await stream.result();
if (result.stopReason !== "toolUse") console.log("[debug] stopReason=", result.stopReason, "err=", result.errorMessage || "", "content=", JSON.stringify(result.content).slice(0, 300));
const toolCalls = result.content.filter((c) => c.type === "toolCall");
const reqBody = seen.completions.at(-1)?.body;
ok(seen.completions.at(-1)?.headers.authorization === "Bearer mock-key", "provider 请求带 Bearer 头");
ok(reqBody?.model === "mock-model" && Array.isArray(reqBody?.messages), "completions 请求形状", `model=${reqBody?.model}`);
ok(Array.isArray(reqBody?.tools) && reqBody.tools.some((t) => t.function?.name === "submit_board"), "submit_board 工具已下发");
ok(toolCalls.length === 1 && toolCalls[0].name === "submit_board", "SSE 工具调用回收", JSON.stringify(toolCalls[0]?.arguments));
ok(toolCalls[0]?.arguments?.intent === "hint", "工具参数完整(intent=hint)");

// ---------- 3) openaiPassthrough(completions) ----------
const fakeRes = () => {
  const r = { status: 0, headers: {}, body: "" };
  r.writeHead = (s, h = {}) => { r.status = s; r.headers = h; };
  r.end = (b) => { r.body = b ?? ""; };
  return r;
};
const anthropicReq = { model: "mock-model", max_tokens: 10, system: "sys text", messages: [{ role: "user", content: "ping" }] };
let r1 = fakeRes();
await openaiPassthrough({ apiFormat: "openai", apiUrl: base, apiKey: "mock-key", model: "mock-model" }, anthropicReq, r1);
const passthroughReq = seen.completions.at(-1)?.body;
ok(r1.status === 200, "透传(completions) 200");
ok(passthroughReq?.stream === false && !("system" in passthroughReq), "透传请求转 openai 形状");
ok(passthroughReq?.messages?.[0]?.role === "system" && passthroughReq.messages[0].content === "sys text", "system 提头");
const out1 = JSON.parse(r1.body);
ok(out1.type === "message" && out1.content?.[0]?.text === "pong from openai", "回包转回 anthropic 形状", out1.content?.[0]?.text);

// ---------- 4) openaiPassthrough(responses) ----------
let r2 = fakeRes();
await openaiPassthrough({ apiFormat: "openai-responses", apiUrl: base, apiKey: "mock-key", model: "gpt-5" }, anthropicReq, r2);
ok(r2.status === 200, "透传(responses) 200");
ok(seen.responses.at(-1)?.body?.input?.[0]?.role === "system", "responses input 形状");
const out2 = JSON.parse(r2.body);
ok(out2.content?.[0]?.text === "pong from responses", "responses 回包提取 output_text", out2.content?.[0]?.text);

// ---------- 5) 端到端:真桥(临时 HOME)+ openai 格式 profile,带图请求全链路 ----------
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "pi-penecho-test-"));
fs.mkdirSync(path.join(tmpHome, ".pi-penecho"), { recursive: true });
fs.writeFileSync(path.join(tmpHome, ".pi-penecho", "config.json"), JSON.stringify({
  version: 2, activeProfile: "default",
  profiles: { default: { apiFormat: "openai", apiUrl: base, apiKey: "mock-key", model: "mock-model", contextWindow: null, maxTokens: null } },
  persona: "general", thinkingLevel: "medium", keepImages: 8, boardFontSize: 66,
}));
const bridgePort = 9391;
const serverEntry = fileURLToPath(new URL("../src/server.mjs", import.meta.url));
const bridge = spawn(process.execPath, [serverEntry], {
  env: { ...process.env, HOME: tmpHome, PI_PENECHO_PORT: String(bridgePort), PI_PENECHO_INSTALL_PORT: "9399", KIMI_API_KEY: "", ANTHROPIC_AUTH_TOKEN: "" },
  stdio: ["ignore", "pipe", "pipe"],
});
let bridgeLog = "";
bridge.stdout.on("data", (d) => (bridgeLog += d));
bridge.stderr.on("data", (d) => (bridgeLog += d));
try {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    up = await fetch(`http://127.0.0.1:${bridgePort}/health`).then((r) => r.ok).catch(() => false);
    if (!up) await new Promise((r) => setTimeout(r, 500));
  }
  ok(up, "桥(openai profile)启动就绪");

  if (up) {
    const pngB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const canvasSystem = "You are the drawing brain. Return strict JSON only: {\"intent\":\"none|hint|...\",\"commands\":[...]}. " + "x".repeat(200);
    const before = seen.completions.length;
    const resp = await fetch(`http://127.0.0.1:${bridgePort}/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": "t", "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "mock-model", max_tokens: 8192, system: canvasSystem,
        messages: [{ role: "user", content: [
          { type: "text", text: "3+2=?" },
          { type: "image", source: { type: "base64", media_type: "image/png", data: pngB64 } },
        ]}],
      }),
    });
    const out = await resp.json();
    ok(resp.status === 200, "带图请求 200");
    const text = (out.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* 下面统一断言 */ }
    ok(parsed?.intent === "hint", "带图全链路:submit_board 经 openai 上游回收", JSON.stringify(parsed));
    const tutorReq = seen.completions.slice(before).find((c) => c.body.stream);
    ok(!!tutorReq, "runTutorTurn 走了 openai 上游(stream)");
    const parts = tutorReq?.body?.messages?.flatMap((m) => Array.isArray(m.content) ? m.content : []) || [];
    ok(parts.some((p) => p?.type === "image_url" && String(p.image_url?.url || "").startsWith("data:image/png;base64,")), "图像以 image_url base64 送达上游");
  }
} finally {
  bridge.kill("SIGKILL");
  fs.rmSync(tmpHome, { recursive: true, force: true });
  if (!failures) {} else console.log("\n--- 桥日志 ---\n" + bridgeLog.split("\n").slice(-15).join("\n"));
}

mock.close();
console.log(failures ? `\n${failures} 项失败` : "\n全部通过");
process.exit(failures ? 1 : 0);
