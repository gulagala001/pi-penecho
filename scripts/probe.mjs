// 探针:验证 pi-agent-core + Kimi For Coding 最小调用(文本 + 图像)
import { Agent } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import { kimiCodingProvider } from "@earendil-works/pi-ai/providers/kimi-coding";
import fs from "node:fs";

process.env.KIMI_API_KEY ||= process.env.ANTHROPIC_AUTH_TOKEN || "";
if (!process.env.KIMI_API_KEY) { console.error("缺少 KIMI_API_KEY/ANTHROPIC_AUTH_TOKEN"); process.exit(1); }

const models = createModels();
models.setProvider(kimiCodingProvider());
const model = models.getModel("kimi-coding", "k3");
if (!model) { console.error("模型 k3 未找到"); process.exit(1); }
console.log("model:", model.id, model.name, "context:", model.contextWindow);

const agent = new Agent({
  initialState: { systemPrompt: "你是助手,回答要极简短。", model },
  streamFn: models.streamSimple.bind(models),
});

let finalText = "";
agent.subscribe((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});

console.log("--- 测试 1: 纯文本 ---");
await agent.prompt("说一句 ok");
await agent.waitForIdle();

console.log("\n--- 测试 2: 图像输入 ---");
// 生成一个小测试图:直接用一张真实手写样例更好,这里先用 penecho readme 图
const imgPath = "/Users/mac/.local/node/lib/node_modules/penecho/public/penecho-mark.png";
const imgB64 = fs.readFileSync(imgPath).toString("base64");
await agent.prompt("这张图里有什么?一句话", [{ type: "image", data: imgB64, mimeType: "image/png" }]);
await agent.waitForIdle();

console.log("\n--- 测试 3: 会话记忆 ---");
await agent.prompt("我刚才给你看的那张图是什么?一句话");
await agent.waitForIdle();

console.log("\n\n=== state.messages 轮数:", agent.state.messages.length, "===");
