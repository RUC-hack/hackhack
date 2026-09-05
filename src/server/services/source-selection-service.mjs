import { randomUUID } from "node:crypto";

import { appError } from "../contracts/errors.mjs";
import { selectedSourceIds, SOURCE_SELECTION_LIMITS, validateSourceSelection } from "../contracts/source-selection.mjs";
import { sourcePublicView } from "../contracts/source-document.mjs";

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function fallbackSelection(packets) {
  const items = packets.slice(0, SOURCE_SELECTION_LIMITS.maxItemsPerGroup).map((packet) => ({
    source_id: packet.source_id,
    reason: "来自本轮检索结果，先作为与当前问题相关的参照材料展示。",
  }));
  return {
    groups: items.length ? [{
      key: "retrieval_candidates",
      title: "本轮检索到的相关经历",
      description: "模型筛选暂时不可用，先按检索顺序展示候选材料。",
      items,
    }] : [],
  };
}

export class SourceSelectionService {
  constructor({ llmGateway, now = () => new Date(), idFactory = randomUUID } = {}) {
    if (!llmGateway || typeof llmGateway.selectSources !== "function") throw new TypeError("SourceSelectionService requires an LLM gateway with selectSources");
    this.llmGateway = llmGateway;
    this.now = now;
    this.idFactory = idFactory;
  }

  async build({ session, evidencePackets = [], sources = [], retrievalMeta = {}, retrievalId = null, signal, requestId = null, metrics = null } = {}) {
    const validPackets = evidencePackets.filter((packet) => packet.status !== "stale" && packet.status !== "rejected");
    const availableSources = new Map(sources.map((source) => [source.source_id, source]));
    const packetSourceIds = new Set(validPackets.map((packet) => packet.source_id));
    if ([...packetSourceIds].some((sourceId) => !availableSources.has(sourceId))) {
      throw appError("EVIDENCE_INVALID", { message: "Evidence refers to a source that is not stored" });
    }

    let selection;
    let selectionStatus = "ready";
    try {
      selection = await this.llmGateway.selectSources({
        session: {
          session_id: session.session_id,
          context_version: session.context_version,
          current_understanding: clone(session.current_understanding),
        },
        evidence_packets: clone(validPackets),
        sources: clone([...availableSources.values()]),
        retrieval_meta: clone(retrievalMeta),
      }, { signal, requestId, metrics });
    } catch (error) {
      if (error?.code && !["SOURCE_SELECTION_INVALID", "LLM_INVALID_RESPONSE", "LLM_CONTENT_FILTER"].includes(error.code)) throw error;
      selection = fallbackSelection(validPackets);
      selectionStatus = "fallback";
    }
    const validation = validateSourceSelection(selection, { sourceIds: packetSourceIds });
    if (!validation.valid) throw appError("SOURCE_SELECTION_INVALID", { details: { errors: validation.errors } });

    const groups = selection.groups.map((group) => ({
      key: group.key,
      title: group.title,
      description: group.description,
      items: group.items.map((item) => ({
        source_id: item.source_id,
        reason: item.reason,
        source: sourcePublicView(availableSources.get(item.source_id)),
      })),
    }));
    return {
      selection_id: `selection_${this.idFactory()}`,
      retrieval_id: retrievalId,
      context_version: session.context_version,
      status: selectionStatus,
      created_at: this.now().toISOString(),
      source_ids: selectedSourceIds(selection),
      groups,
    };
  }
}
