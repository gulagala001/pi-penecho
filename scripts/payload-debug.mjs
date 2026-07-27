import { createModels } from "@earendil-works/pi-ai";
import { kimiCodingProvider } from "@earendil-works/pi-ai/providers/kimi-coding";
import fs from "node:fs";
import os from "node:os";
const models = createModels();
models.setProvider(kimiCodingProvider());
const template = models.getModel("kimi-coding", "k3");
const model = { ...template, id: prof.model, name: prof.model, baseUrl: prof.apiUrl, contextWindow: prof.contextWindow || 262144, maxTokens: prof.maxTokens || 32768 };
// 从 pi-penecho 配置读当前 profile(调试目标 = 桥的当前端点/模型)
const cfg = JSON.parse(fs.readFileSync(os.homedir() + "/.pi-penecho/config.json", "utf8"));
const prof = cfg.profiles[cfg.activeProfile];
const key = prof.apiKey;
const level = process.argv[2] || null;
const opts = { apiKey: key };
if (level) opts.reasoning = level;
const stream = models.streamSimple(model, {
  systemPrompt: "Return strict JSON only.",
  messages: [{ role: "user", content: "1+1=? JSON 回答" }],
}, opts);
for await (const ev of stream) {
  if (ev.type === "done") {
    const blocks = (ev.message?.content || []).map(c => c.type);
    const text = (ev.message?.content || []).filter(c => c.type === "text").map(c => c.text).join("");
    console.log(`reasoning=${level}: blocks=${JSON.stringify(blocks)} text=${JSON.stringify(text.slice(0, 80))}`);
  }
}
