const { CAT_CONFIGS } = require('./cats');

function stripCodeBlocks(text) {
  return text.replace(/```[\s\S]*?```/g, '');
}

function parseA2AMentions(text, currentCatId, options = {}) {
  const maxTargets = options.maxTargets == null ? 2 : options.maxTargets;
  if (!text) return [];
  const stripped = stripCodeBlocks(text);
  const found = [];

  for (const [id, config] of Object.entries(CAT_CONFIGS)) {
    if (id === currentCatId) continue;
    for (const pattern of config.mentionPatterns) {
      const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`^\\s*${escaped}`, 'mi');
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
