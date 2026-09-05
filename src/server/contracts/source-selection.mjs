const SOURCE_SELECTION_LIMITS = Object.freeze({
  maxGroups: 3,
  maxItemsPerGroup: 3,
  maxKeyChars: 60,
  maxTitleChars: 80,
  maxDescriptionChars: 180,
  maxReasonChars: 180,
});

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateSourceSelection(selection, { sourceIds = null } = {}) {
  const errors = [];
  if (!isObject(selection)) return { valid: false, errors: ["source_selection_not_object"] };
  if (!Array.isArray(selection.groups)) {
    errors.push("source_selection_groups_must_be_array");
    return { valid: false, errors };
  }
  if (selection.groups.length > SOURCE_SELECTION_LIMITS.maxGroups) errors.push("source_selection_groups_too_many");

  const selected = new Set();
  for (const [groupIndex, group] of selection.groups.entries()) {
    if (!isObject(group)) {
      errors.push(`source_selection_group_${groupIndex}_not_object`);
      continue;
    }
    if (!text(group.key)) errors.push(`source_selection_group_${groupIndex}_key_required`);
    else if (group.key.length > SOURCE_SELECTION_LIMITS.maxKeyChars) errors.push(`source_selection_group_${groupIndex}_key_too_long`);
    if (!text(group.title)) errors.push(`source_selection_group_${groupIndex}_title_required`);
    else if (group.title.length > SOURCE_SELECTION_LIMITS.maxTitleChars) errors.push(`source_selection_group_${groupIndex}_title_too_long`);
    if (!text(group.description)) errors.push(`source_selection_group_${groupIndex}_description_required`);
    else if (group.description.length > SOURCE_SELECTION_LIMITS.maxDescriptionChars) errors.push(`source_selection_group_${groupIndex}_description_too_long`);
    if (!Array.isArray(group.items)) {
      errors.push(`source_selection_group_${groupIndex}_items_must_be_array`);
      continue;
    }
    if (group.items.length < 1 || group.items.length > SOURCE_SELECTION_LIMITS.maxItemsPerGroup) {
      errors.push(`source_selection_group_${groupIndex}_items_invalid`);
    }
    for (const [itemIndex, item] of group.items.entries()) {
      if (!isObject(item)) {
        errors.push(`source_selection_group_${groupIndex}_item_${itemIndex}_not_object`);
        continue;
      }
      if (!text(item.source_id)) errors.push(`source_selection_group_${groupIndex}_item_${itemIndex}_source_id_required`);
      else {
        if (selected.has(item.source_id)) errors.push(`source_selection_duplicate_source_${item.source_id}`);
        selected.add(item.source_id);
        if (sourceIds && !sourceIds.has(item.source_id)) errors.push(`source_selection_source_id_not_found_${item.source_id}`);
      }
      if (!text(item.reason)) errors.push(`source_selection_group_${groupIndex}_item_${itemIndex}_reason_required`);
      else if (item.reason.length > SOURCE_SELECTION_LIMITS.maxReasonChars) errors.push(`source_selection_group_${groupIndex}_item_${itemIndex}_reason_too_long`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function assertSourceSelection(selection, options) {
  const validation = validateSourceSelection(selection, options);
  if (!validation.valid) throw new TypeError(`SourceSelection is invalid: ${validation.errors.join(", ")}`);
  return selection;
}

export function selectedSourceIds(selection) {
  return [...new Set((selection?.groups ?? []).flatMap((group) => (group?.items ?? []).map((item) => item?.source_id).filter(Boolean)))];
}

export { SOURCE_SELECTION_LIMITS };
