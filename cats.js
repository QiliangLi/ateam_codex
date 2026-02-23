const CAT_CONFIGS = {
  opus: {
    cli: 'claude',
    name: '布偶猫',
    mentionPatterns: ['@布偶猫', '@opus', '@claude']
  },
  codex: {
    cli: 'codex',
    name: '缅因猫',
    mentionPatterns: ['@缅因猫', '@codex']
  },
  gemini: {
    cli: 'gemini',
    name: '暹罗猫',
    mentionPatterns: ['@暹罗猫', '@gemini']
  }
};

function getCatConfig(catId) {
  return CAT_CONFIGS[catId];
}

function listCatIds() {
  return Object.keys(CAT_CONFIGS);
}

module.exports = {
  CAT_CONFIGS,
  getCatConfig,
  listCatIds
};
