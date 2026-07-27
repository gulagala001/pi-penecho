// 模拟 PenEcho 请求,测试桥接全链路:工具调用 + JSON 输出 + 会话记忆
import fs from "node:fs";

const imgB64 = fs.readFileSync("/Users/mac/.local/node/lib/node_modules/penecho/public/penecho-mark.png").toString("base64");

const CANVAS_CONTRACT = `You are the drawing brain for a handwritten visual Q&A board. Return strict JSON only: {"intent":"none|hint|continue|explain|plot|correct|erase|answer|typeset","observedText":"what you can read, optional","message":"short optional","commands":[...]}. Available tools: write_text {tool:"write_text",x,y,text,fontSize,maxWidth,lineHeight}; draw_formula {tool:"draw_formula",x,y,latex,fontSize}. The logical canvas is 20000 by 20000. ALL returned coordinates must be finite global logical coordinates. Every command MUST identify its tool with property "tool". Strict JSON only: no markdown, no prose outside JSON.`;

async function ask(label, userText) {
  console.log(`\n===== ${label} =====`);
  const t0 = Date.now();
  const res = await fetch("http://127.0.0.1:9191/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": "test", "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "k3", max_tokens: 8192, system: CANVAS_CONTRACT,
      messages: [{ role: "user", content: [
        { type: "text", text: userText + `\n\n[几何元数据] {"latestInput":{"imageRect":{"x":0,"y":0,"w":1024,"h":768}},"canvasSize":{"w":20000,"h":20000}}` },
        { type: "image", source: { type: "base64", media_type: "image/png", data: imgB64 } },
      ]}],
    }),
  });
  const json = await res.json();
  console.log(`status=${res.status} 耗时=${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const text = (json.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  try {
    const p = JSON.parse(text);
    console.log("intent:", p.intent, "| observedText:", p.observedText || "(无)");
    console.log("commands:", (p.commands || []).map((c) => c.tool).join(", ") || "(无)");
    const wt = (p.commands || []).find((c) => c.tool === "write_text");
    if (wt) console.log("write_text 内容预览:", wt.text.slice(0, 150));
  } catch { console.log("原始返回(非JSON):", text.slice(0, 300)); }
}

await ask("第1轮:学生问今天该学什么(应触发读看板工具)", "学生在白板上问:今天该学什么?(你的第一节课——按职责先读档案了解进度)");
await ask("第2轮:测会话记忆", "学生接着问:那我上次学到哪了?(不许再读文件,用你刚才读到的回答)");
console.log("\n===== 完成 =====");
