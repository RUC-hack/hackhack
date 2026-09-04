export function zhihuItem(overrides = {}) {
  return {
    Title: "读研还是工作：一段个人经历",
    ContentType: "answer",
    ContentID: "answer-1",
    ContentText: "我先工作两年，后来重新读研。这个摘要只作为测试数据。",
    Url: "https://www.zhihu.com/question/1/answer/1",
    VoteUpCount: 42,
    AuthorName: "测试作者",
    AuthorityLevel: 2,
    RankingScore: 0.98,
    ...overrides,
  };
}

export function successResponse(items = [zhihuItem()]) {
  return {
    Code: 0,
    Message: "success",
    Data: { Items: items },
  };
}

export function rawSuccess(items = [zhihuItem()]) {
  return {
    transportOk: true,
    httpStatus: 200,
    latencyMs: 12,
    attemptCount: 1,
    body: successResponse(items),
    parseError: null,
    nonJsonBodyPreview: null,
    validation: { valid: true, errors: [], itemCount: items.length },
  };
}
