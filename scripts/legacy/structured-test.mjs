// 实验:结构化输出(submit_board 工具)在两个端点上的接受度
import { createModels, Type } from "@earendil-works/pi-ai";
import { kimiCodingProvider } from "@earendil-works/pi-ai/providers/kimi-coding";
import fs from "node:fs";
import os from "node:os";

const cfg = JSON.parse(fs.readFileSync(os.homedir() + "/.pi-penecho/config.json", "utf8"));
const prof = cfg.profiles[cfg.activeProfile];
const models = createModels();
models.setProvider(kimiCodingProvider());
const template = models.getModel("kimi-coding", "k3");
const model = { ...template, id: prof.model, name: prof.model, baseUrl: prof.apiUrl, contextWindow: prof.contextWindow || 262144, maxTokens: prof.maxTokens || 32768 };

const submitBoard = {
  name: "submit_board",
  label: "提交板书",
  description: "提交你对白板的回应。所有回应必须通过此工具提交,不要输出普通文本。",
  parameters: Type.Object({
    intent: Type.Union(["none","hint","continue","explain","plot","correct","erase","answer","typeset"].map(x => Type.Literal(x))),
    observedText: Type.Optional(Type.String()),
    message: Type.Optional(Type.String()),
    commands: Type.Array(Type.Object({}, { additionalProperties: true })),
  }),
  constrainedSampling: { type: "json_schema", strict: "prefer" },
};

const stream = models.streamSimple(model, {
  systemPrompt: "你是白板助手。用户的每次输入你都必须调用 submit_board 工具提交回应,禁止普通文本回复。",
  messages: [{ role: "user", content: "学生写:1+1等于几?回答并把答案 2 用 write_text 命令写在坐标 (100,100)" }],
  tools: [submitBoard],
}, { apiKey: prof.apiKey, reasoning: "low" });

for await (const ev of stream) {
  if (ev.type === "done") {
    const blocks = ev.message?.content || [];
    for (const b of blocks) {
      if (b.type === "toolCall") console.log("TOOL CALL:", b.name, JSON.stringify(b.arguments).slice(0, 400));
      if (b.type === "text") console.log("TEXT:", JSON.stringify(b.text.slice(0, 200)));
    }
    console.log("blocks:", JSON.stringify(blocks.map(b => b.type)), "stopReason:", ev.message?.stopReason);
  }
  if (ev.type === "error") console.log("ERROR:", JSON.stringify(ev.error?.errorMessage || ev).slice(0, 400));
}
