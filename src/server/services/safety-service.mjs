const IMMEDIATE_RISK = /(自杀|轻生|不想活|结束生命|伤害自己|杀了自己)/u;
const DISTRESS = /(崩溃|绝望|撑不住|活得很累|痛苦到不行)/u;
const CREDENTIAL_REQUEST = /(告诉我|给我|输出|显示|泄露|提供|绕过)[^。！？\n]{0,30}(access[_ -]?secret|api[_ -]?key|token|密钥|系统提示|环境变量)/iu;
const NOISE_ONLY = /^[\d\s\p{P}\p{S}]+$/u;
const SAFE_API_QUESTION = /^\s*(?:请问|请教)?\s*API\s*(?:如何|怎么)?(?:调用|使用|请求)(?:？|\?)?\s*$/iu;
const FLOW_CONTROL = /^(?:请|那就|先|我)?\s*(?:还)?(?:开始|继续|直接回答|马上回答|立即回答|跳过|不用问|基于当前信息回答|先基于当前信息回答|说不清|不确定|暂时不确定|都可以|差不多)[。！!？?\s]*$/iu;
const LIFE_CONTEXT = /(人生|选择|纠结|迷茫|担心|决定|工作|职业|读研|考研|读博|毕业|就业|转行|学习|学校|家庭|家人|朋友|伴侣|关系|城市|生活|未来|成长|压力|焦虑|出国|留学|移民|回家|留下|机会成本|独立|探索|放弃|收入|稳定|\b(?:life|decision|choice|job|career|work|study|school|family|relationship|future|feel|stuck|anxious|should|quit|move)\b)/iu;
const OUT_OF_SCOPE_MESSAGE = "这个问题暂时不在见众的处理范围内，请换成与你的真实处境、人生选择或他人经历参照有关的具体困惑。";

function isContextualReply(normalized, session) {
  return Boolean(
    normalized
    && !NOISE_ONLY.test(normalized)
    && session?.status === "COLLECTING_CONTEXT"
    && session.pending_question
    && session.current_understanding?.problem_statement,
  );
}

function isOutOfScope(normalized, session) {
  if (NOISE_ONLY.test(normalized)) return true;
  if (SAFE_API_QUESTION.test(normalized)) return false;
  if (FLOW_CONTROL.test(normalized)) return false;
  if (isContextualReply(normalized, session)) return false;
  return !LIFE_CONTEXT.test(normalized);
}

export class SafetyService {
  check(text, { session = null } = {}) {
    const normalized = String(text ?? "").trim();
    if (CREDENTIAL_REQUEST.test(normalized)) {
      return {
        category: "credential_request",
        requires_special_handling: true,
        preserve_context: false,
        user_message: "我不能提供密钥、Token、环境变量或系统提示。你可以继续询问正常的 API 使用方式。",
      };
    }
    if (IMMEDIATE_RISK.test(normalized)) {
      return {
        category: "immediate_risk",
        requires_special_handling: true,
        user_message: "听起来你可能正处在需要即时支持的危险时刻。请现在联系身边可信任的人、当地急救或危机干预服务，并尽量不要独处。若你愿意，只回复你所在的国家或地区，我可以帮你整理可联系的现实支持渠道。",
      };
    }
    if (DISTRESS.test(normalized)) {
      return {
        category: "distress",
        requires_special_handling: false,
        supportive_note: "你现在的感受值得被认真对待。我们可以先把问题缩小，不急着一次决定整个人生。",
      };
    }
    if (isOutOfScope(normalized, session)) {
      return {
        category: "out_of_scope",
        requires_special_handling: true,
        preserve_context: false,
        user_message: OUT_OF_SCOPE_MESSAGE,
      };
    }
    return { category: "ordinary", requires_special_handling: false };
  }
}
