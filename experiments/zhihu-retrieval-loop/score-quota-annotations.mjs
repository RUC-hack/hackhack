import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const token = argv[index];
    const value = argv[index + 1];
    if (!token?.startsWith("--") || !value) throw new Error("Arguments must use --name value pairs");
    args[token.slice(2)] = value;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.input || !args.output) throw new Error("--input and --output are required");
const inputPath = path.resolve(args.input);
const outputPath = path.resolve(args.output);
const rows = (await readFile(inputPath, "utf8"))
  .split(/\r?\n/u)
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line));

// Conservative single-rater review of the saved Top-5 snippets.
// Tuple order: relevance, lived_experience, evidence_sufficiency, usable, note.
const scores = {
  "C01|generated": [[2, 2, 2, true, "个人自学到就业经历"], [2, 2, 2, true, "直接讨论计算机考研与就业"], [2, 1, 1, true, "同类选择，个人经历较弱"], [1, 2, 2, true, "讨论读研意义并给出个人结果"], [2, 2, 2, true, "大三迷茫到就业/备考经历"]],
  "C01|baseline": [[2, 2, 2, true, "计算机本科规划经历"], [2, 2, 2, true, "直接比较读研与就业"], [1, 0, 1, false, "泛化建议，缺少个人路径"], [2, 2, 2, true, "个人考研与就业经历"], [2, 1, 1, true, "直接回答读研/就业但经历较弱"]],
  "C03|baseline": [[2, 2, 2, true, "北京大厂与家乡银行的直接经历"], [2, 0, 1, false, "城市比较清单，无清晰个人结果"], [1, 0, 1, false, "银行薪资泛文"], [2, 1, 2, true, "具体求职案例与选择结果"], [1, 0, 1, false, "银行报考泛建议"]],
  "C03|generated": [[2, 2, 2, true, "北京大厂与家乡银行的直接经历"], [2, 1, 2, true, "具体求职案例与选择结果"], [2, 2, 2, true, "本人校招与 offer 选择经历"], [1, 0, 1, false, "薪资泛文"], [2, 2, 2, true, "直接比较两种 offer 并给出后果"]],
  "C05|baseline": [[1, 0, 1, false, "转专业相关但不是保研跨考经历"], [1, 0, 1, false, "转专业泛建议"], [1, 0, 1, false, "泛化转专业建议"], [2, 2, 2, true, "放弃保研考研的直接经历"], [2, 1, 2, true, "跨考选择建议，经历较弱"]],
  "C05|generated": [[2, 2, 2, true, "放弃保研跨考的完整经历"], [2, 2, 2, true, "放弃保研与出国的个人经历"], [2, 2, 2, true, "跨考失败与后续结果"], [2, 2, 2, true, "放弃保研的个人体验"], [2, 1, 2, true, "放弃保研跨考的案例与结果"]],
  "C07|baseline": [[2, 2, 2, true, "二战/工作经验分享"], [2, 2, 2, true, "本人多次考研与工作经历"], [2, 0, 1, false, "泛化二战建议"], [2, 0, 1, false, "条件清单式建议"], [2, 1, 1, true, "直接讨论失败后选择，个人经历较弱"]],
  "C07|generated": [[2, 2, 2, true, "二战失败反思经历"], [2, 2, 2, true, "二战失利后的职业成长经历"], [2, 0, 1, false, "泛化二战建议"], [2, 2, 2, true, "多次失败与后续结果"], [2, 1, 2, true, "一战失败案例与后续路径"]],
};

for (const row of rows) {
  const tuple = scores[`${row.case_id}|${row.strategy}`]?.[row.rank - 1];
  if (!tuple) throw new Error(`Missing score for ${row.case_id}|${row.strategy}|rank${row.rank}`);
  [row.relevance, row.lived_experience, row.evidence_sufficiency, row.usable, row.notes] = tuple;
  row.rater_id = "codex-single-rater";
}

await writeFile(outputPath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
console.error(`Scored ${rows.length} rows to ${outputPath}`);
