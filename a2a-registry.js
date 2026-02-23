const { parseA2AMentions } = require('./a2a-mentions');

const threadWorklistRegistry = new Map();

function registerWorklist(threadId, list) {
  threadWorklistRegistry.set(threadId, { list, scheduled: new Set(list) });
}

function unregisterWorklist(threadId) {
  threadWorklistRegistry.delete(threadId);
}

function enqueueA2ATargets(threadId, content, sourceCatId, options = {}) {
  const targets = parseA2AMentions(content, sourceCatId, options);
  if (targets.length === 0) return [];

  const ref = threadWorklistRegistry.get(threadId);
  if (!ref) return [];

  for (const cat of targets) {
    if (!ref.scheduled.has(cat)) {
      ref.list.push(cat);
      ref.scheduled.add(cat);
    }
  }
  return targets;
}

function getWorklist(threadId) {
  return threadWorklistRegistry.get(threadId)?.list || null;
}

module.exports = {
  registerWorklist,
  unregisterWorklist,
  enqueueA2ATargets,
  getWorklist
};
