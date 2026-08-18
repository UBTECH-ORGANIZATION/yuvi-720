/* ── xAPI transport ──────────────────────────────────────────────────────
 * Fire-and-forget, retried, and never in the learner's way. Statements go out
 * CONCURRENTLY: our ingest folds each one into the brain and forwards it to the
 * MoE LRS before answering, so a strictly serial queue fell seconds behind a
 * learner who was still clicking — and a component completion that has not left
 * the page yet is a component completion that can be lost on close. Order does
 * not need the queue: every statement carries its own timestamp, and the
 * platform's position clock is what resolves them.
 */

import { CATEGORY, OBJECT, VERB, componentId, launch } from './context.js';

const MAX_IN_FLIGHT = 4;
const queue = [];
let inFlight = 0;

export function report(verb, { object, result, extensions, category } = {}) {
  if (!launch?.endpoint || !launch?.auth) return;
  const statement = {
    actor: launch.actor,
    verb: { id: `${VERB}${verb}` },
    object: { id: object || `${OBJECT}${componentId}` },
    timestamp: new Date().toISOString(),
  };
  if (result) statement.result = result;
  const context = {};
  if (extensions) context.extensions = extensions;
  if (category) context.contextActivities = { category: [{ id: `${CATEGORY}${category}` }] };
  if (Object.keys(context).length) statement.context = context;
  queue.push({ statement, tries: 0 });
  pump();
}

function pump() {
  while (inFlight < MAX_IN_FLIGHT && queue.length) {
    const job = queue.shift();
    inFlight += 1;
    send(job).finally(() => { inFlight -= 1; pump(); });
  }
}

async function send(job) {
  try {
    const response = await fetch(`${launch.endpoint.replace(/\/$/, '')}/statements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: launch.auth },
      body: JSON.stringify(job.statement),
      // Survives the tab closing mid-flight — a completion must not depend on
      // the learner staying on the page long enough for us to finish.
      keepalive: true,
    });
    if (!response.ok && response.status >= 500) throw new Error(String(response.status));
  } catch {
    job.tries += 1;
    if (job.tries > 5) return;
    // Mandated retry policy: back off, stay invisible to the learner.
    await new Promise((resolve) => setTimeout(resolve, Math.min(15000, 800 * 2 ** job.tries)));
    queue.push(job);
  }
}
