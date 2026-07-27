// 文件工具:read_file / write_file / append_file / list_dir,限定 persona 的 workspace 根目录
// persona 无 workspace → 不注册工具(纯白板对话)
import { Type } from "@earendil-works/pi-ai";
import fs from "node:fs";
import path from "node:path";

export function createWorkspaceTools(workspace) {
  if (!workspace) return [];
  const ROOT = workspace;

  function safeResolve(p) {
    const abs = path.resolve(ROOT, String(p || "."));
    if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) throw new Error(`路径越界(只允许工作区内): ${p}`);
    return abs;
  }
  const text = (t) => ({ content: [{ type: "text", text: t }] });

  return [
    {
      name: "read_file",
      label: "读文件",
      description: `读取工作区内的一个文本文件。路径相对工作区根目录(${ROOT})。`,
      parameters: Type.Object({ path: Type.String({ description: "相对工作区根目录的路径" }) }),
      execute: async (id, { path: p }) => {
        const t = fs.readFileSync(safeResolve(p), "utf8");
        const MAX = 100_000;
        return text(t.length > MAX ? t.slice(0, MAX) + "\n…[过长已截断]" : t);
      },
    },
    {
      name: "write_file",
      label: "写文件",
      description: "创建或覆盖写入工作区内的文本文件(自动建父目录)。",
      parameters: Type.Object({
        path: Type.String({ description: "相对路径" }),
        content: Type.String({ description: "完整文件内容" }),
      }),
      execute: async (id, { path: p, content }) => {
        const abs = safeResolve(p);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, "utf8");
        return text(`已写入 ${p}(${String(content).length} 字符)`);
      },
    },
    {
      name: "append_file",
      label: "追加文件",
      description: "在工作区内某文件末尾追加内容(文件不存在则创建)。续写场景用这个,比整篇重写可靠。",
      parameters: Type.Object({
        path: Type.String({ description: "相对路径" }),
        content: Type.String({ description: "要追加的内容" }),
      }),
      execute: async (id, { path: p, content }) => {
        const abs = safeResolve(p);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.appendFileSync(abs, content, "utf8");
        return text(`已追加到 ${p}(${String(content).length} 字符)`);
      },
    },
    {
      name: "list_dir",
      label: "列目录",
      description: "列出工作区内某目录的直接子项(不递归)。",
      parameters: Type.Object({ path: Type.String({ description: "相对路径,空为根目录" }) }),
      execute: async (id, { path: p }) => {
        const items = fs.readdirSync(safeResolve(p || "."), { withFileTypes: true })
          .map((d) => (d.isDirectory() ? "📁 " : "📄 ") + d.name);
        return text(items.join("\n") || "(空目录)");
      },
    },
  ];
}
