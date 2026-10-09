import { ActiveCheckSnapshot } from './repos';

type SnapshotWrite = ActiveCheckSnapshot & { clearPending?: boolean };

export function cloneSnapshot(payload: ActiveCheckSnapshot): ActiveCheckSnapshot {
  const copy = JSON.parse(JSON.stringify(payload)) as SnapshotWrite;
  delete copy.clearPending;
  return copy;
}

/**
 * Last-write-wins for the live check, except two fields other processes may set:
 * pendingDecision is kept until the owner records a clear, and actionsAllowed only turns on.
 */
export function mergeActiveSnapshot(
  current: ActiveCheckSnapshot | null,
  incoming: ActiveCheckSnapshot,
): ActiveCheckSnapshot {
  const write = incoming as SnapshotWrite;
  const clearPending = write.clearPending === true;
  const explicit = write.pendingDecision;
  const next = cloneSnapshot(incoming);
  if (!current) {
    next.pendingDecision = explicit === 'allow' || explicit === 'deny' ? explicit : null;
    return next;
  }
  if (explicit === 'allow' || explicit === 'deny') next.pendingDecision = explicit;
  else if (clearPending) next.pendingDecision = null;
  else if (current.pendingDecision === 'allow' || current.pendingDecision === 'deny') {
    next.pendingDecision = current.pendingDecision;
  } else next.pendingDecision = null;
  next.actionsAllowed = current.actionsAllowed || next.actionsAllowed;
  return next;
}
