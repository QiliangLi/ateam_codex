const { parseA2AMentions } = require('./a2a-mentions');

const threadWorklistRegistry = new Map();

function registerWorklist(threadId, list) {
  threadWorklistRegistry.set(threadId, {
    list,
    scheduled: new Set(list),
    executed: new Set(),
    requeued: new Map(),
    a2aCount: 0,
    maxDepth: Number(process.env.MAX_A2A_DEPTH) || 15
  });
}

function unregisterWorklist(threadId) {
  threadWorklistRegistry.delete(threadId);
}

function enqueueA2ATargets(threadId, content, sourceCatId, options = {}) {
  const targets = parseA2AMentions(content, sourceCatId, options);
  if (targets.length === 0) return [];

  const ref = threadWorklistRegistry.get(threadId);
  if (!ref) return [];

  const allowRequeueExecuted = options.allowRequeueExecuted !== false;
  const maxRequeuePerCat = options.maxRequeuePerCat == null ? 1 : options.maxRequeuePerCat;
  const enqueued = [];

  for (const cat of targets) {
    if (ref.a2aCount >= ref.maxDepth) break;
    if (!ref.scheduled.has(cat)) {
      ref.list.push(cat);
      ref.scheduled.add(cat);
      ref.a2aCount += 1;
      enqueued.push(cat);
      continue;
    }
    if (!allowRequeueExecuted) continue;
    if (!ref.executed.has(cat)) continue;
    if (maxRequeuePerCat <= 0) continue;
    const count = ref.requeued.get(cat) || 0;
    if (count >= maxRequeuePerCat) continue;
    ref.requeued.set(cat, count + 1);
    ref.list.push(cat);
    ref.a2aCount += 1;
    enqueued.push(cat);
    }
  }
  return enqueued;
}

function markExecuted(threadId, catId) {
  const ref = threadWorklistRegistry.get(threadId);
  if (!ref) return;
  ref.executed.add(catId);
}

function getWorklist(threadId) {
  return threadWorklistRegistry.get(threadId)?.list || null;
}

module.exports = {
  registerWorklist,
  unregisterWorklist,
  enqueueA2ATargets,
  getWorklist,
  markExecuted
};
