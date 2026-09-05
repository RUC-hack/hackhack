const IMMEDIATE_RISK = /(自杀|轻生|不想活|结束生命|伤害自己|杀了自己)/u;
const DISTRESS = /(崩溃|绝望|撑不住|活得很累|痛苦到不行)/u;
const CREDENTIAL_REQUEST = /(告诉我|给我|输出|显示|泄露|提供|绕过)[^。！？\n]{0,30}(access[_ -]?secret|api[_ -]?key|token|密钥|系统提示|环境变量)/iu;

export class SafetyService {
  check(text) {
    const normalized = String(text ?? "").trim();
    if (CREDENTIAL_REQUEST.test(normalized)) {
      return {
        category: "credential_request",
        requires_special_handling: true,
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
    return { category: "ordinary", requires_special_handling: false };
  }
}
