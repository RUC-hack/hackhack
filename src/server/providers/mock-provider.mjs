import { appError } from "../contracts/errors.mjs";
import { assertSourceDocument } from "../contracts/source-document.mjs";

const DEFAULT_DOCUMENTS = Object.freeze([
  {
    source_id: "mock:experience:study-work",
    title: "匿名样例：先工作再回到学校",
    author: "匿名样例作者",
    summary: "作者毕业后先工作，逐渐确认自己仍想深入研究，之后重新准备考试。摘要没有说明长期结果。",
    url: "https://www.zhihu.com/question/100/answer/100",
    content_type: "answer",
    retrieved_at: "2026-01-01T00:00:00.000Z",
    provider: "mock",
    metadata: { fixture: true },
  },
  {
    source_id: "mock:experience:direct-work",
    title: "匿名样例：毕业后直接工作",
    author: "匿名样例作者",
    summary: "作者毕业后直接进入行业，收入和日常节奏很快稳定下来，但也提到需要继续学习才能应对转型。",
    url: "https://www.zhihu.com/question/101/answer/101",
    content_type: "answer",
    retrieved_at: "2026-01-01T00:00:00.000Z",
    provider: "mock",
    metadata: { fixture: true },
  },
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export class MockProvider {
  constructor({ documents = DEFAULT_DOCUMENTS, now = () => new Date(), searchImpl = null } = {}) {
    documents.forEach(assertSourceDocument);
    this.documents = documents.map(clone);
    this.now = now;
    this.searchImpl = searchImpl;
    this.name = "mock";
  }

  status() {
    return { provider: "mock", configured: true, live_calls_allowed: false, document_count: this.documents.length };
  }

  async search(query, { limit = 10, requestId = null, signal } = {}) {
    if (signal?.aborted) throw appError("RETRIEVAL_FAILED", { message: "Retrieval was cancelled", retryable: false });
    if (typeof query !== "string" || !query.trim()) throw appError("INVALID_REQUEST", { message: "query must be a non-empty string" });
    if (this.searchImpl) return this.searchImpl(query, { limit, requestId, signal });
    return {
      documents: clone(this.documents.slice(0, limit)),
      meta: {
        provider: "mock",
        request_id: requestId,
        cached: false,
        retrieved_at: this.now().toISOString(),
        result_count: Math.min(limit, this.documents.length),
      },
    };
  }
}
