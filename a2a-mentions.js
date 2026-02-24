const { CAT_CONFIGS } = require('./cats');

function stripCodeBlocks(text) {
  return text.replace(/```[\s\S]*?```/g, '');
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseA2AMentions(text, currentCatId, options = {}) {
  const maxTargets = options.maxTargets == null ? 2 : options.maxTargets;
  const mode = options.mode || 'agent';
  if (!text) return [];

  const stripped = stripCodeBlocks(text);
  const found = [];

  for (const [id, config] of Object.entries(CAT_CONFIGS)) {
    if (id === currentCatId) continue;

    for (const pattern of config.mentionPatterns) {
      const escaped = escapeRegex(pattern);
      const regex = mode === 'agent'
        ? new RegExp(`(^|\\n)\\s*(?:[-*•]|\\d+\\.)?\\s*${escaped}(?=\\s|$)`, 'i')
        : new RegExp(`(^|[^\\w])${escaped}(?=$|[^\\w])`, 'i');
      if (regex.test(stripped)) {
        if (!found.includes(id)) found.push(id);
        break;
      }
    }

    if (found.length >= maxTargets) break;
  }

  return found;
}

module.exports = {
  parseA2AMentions
};
