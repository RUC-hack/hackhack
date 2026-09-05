export const EVIDENCE_STATUSES = Object.freeze(["candidate", "validated", "used", "stale", "rejected"]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateEvidencePacket(packet, { sourceIds = null } = {}) {
  const errors = [];
  if (!isObject(packet)) return { valid: false, errors: ["evidence_not_object"] };
  for (const field of ["case_id", "source_id", "raw_summary", "narrative"]) {
    if (!text(packet[field])) errors.push(`${field}_required`);
  }
  if (!Array.isArray(packet.observations)) errors.push("observations_must_be_array");
  if (!Array.isArray(packet.tensions)) errors.push("tensions_must_be_array");
  if (!Array.isArray(packet.unknowns)) errors.push("unknowns_must_be_array");
  if (!Array.isArray(packet.candidate_relations)) errors.push("candidate_relations_must_be_array");
  if (packet.status !== undefined && !EVIDENCE_STATUSES.includes(packet.status)) errors.push("status_invalid");
  if (sourceIds && !sourceIds.has(packet.source_id)) errors.push("source_id_not_found");
  for (const [index, observation] of (packet.observations ?? []).entries()) {
    if (!isObject(observation)) {
      errors.push(`observation_${index}_not_object`);
      continue;
    }
    if (!text(observation.label) || !text(observation.value)) errors.push(`observation_${index}_missing_text`);
    if (observation.evidence !== undefined) {
      if (!text(observation.evidence)) errors.push(`observation_${index}_evidence_empty`);
      else if (typeof packet.raw_summary === "string" && !packet.raw_summary.includes(observation.evidence)) {
        errors.push(`observation_${index}_evidence_not_in_summary`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

export function assertEvidencePacket(packet, options) {
  const validation = validateEvidencePacket(packet, options);
  if (!validation.valid) throw new TypeError(`EvidencePacket is invalid: ${validation.errors.join(", ")}`);
  return packet;
}
