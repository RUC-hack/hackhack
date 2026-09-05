import { randomUUID } from "node:crypto";

import { appError } from "../contracts/errors.mjs";
import { assertEvidencePacket, validateEvidencePacket } from "../contracts/evidence.mjs";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export class EvidenceService {
  constructor({ now = () => new Date(), idFactory = randomUUID } = {}) {
    this.now = now;
    this.idFactory = idFactory;
  }

  buildPackets({ sources = [], session, retrievalId = null } = {}) {
    const packets = sources.map((source) => {
      const rawSummary = String(source.summary ?? "");
      const hasEvidence = rawSummary.trim().length > 0;
      const packet = {
        case_id: `case_${this.idFactory()}`,
        source_id: source.source_id,
        raw_summary: rawSummary,
        narrative: hasEvidence ? rawSummary : "摘要没有提供足够的经历细节。",
        observations: hasEvidence ? [{
          label: "摘要中明确出现的经历",
          value: rawSummary,
          evidence: rawSummary,
          certainty: "explicit",
        }] : [],
        tensions: [],
        unknowns: hasEvidence ? ["完整原文和长期结果未必包含在摘要中。"] : ["摘要为空，无法确认经历内容。"],
        candidate_relations: [],
        status: "validated",
        unclassified: true,
        context_version: session?.context_version ?? 1,
        retrieval_id: retrievalId,
        created_at: this.now().toISOString(),
      };
      const validation = validateEvidencePacket(packet, { sourceIds: new Set(sources.map((item) => item.source_id)) });
      if (!validation.valid) throw appError("EVIDENCE_INVALID", { details: { source_id: source.source_id, errors: validation.errors } });
      return packet;
    });
    return packets;
  }

  assertPackets(packets, sourceIds) {
    const known = sourceIds instanceof Set ? sourceIds : new Set(sourceIds);
    packets.forEach((packet) => assertEvidencePacket(packet, { sourceIds: known }));
    return packets;
  }

  addToSession(session, packets) {
    this.assertPackets(packets, new Set(packets.map((packet) => packet.source_id)));
    session.evidence_packets.push(...clone(packets));
    return session;
  }

  currentPackets(session) {
    return clone((session.evidence_packets ?? []).filter((packet) => packet.status !== "stale" && packet.status !== "rejected"));
  }
}
