import { PrismaClient, Prisma } from "@prisma/client";
import { seedState, requestStatus } from "./domain.js";
export const prisma = new PrismaClient();
export async function initialize(db = prisma) {
  await db.workspace.upsert({
    where: { id: "demo" },
    create: { id: "demo", payload: seedState() },
    update: {},
  });
}
export const readState = async (db = prisma) => {
  const record = await db.workspace.findUniqueOrThrow({
    where: { id: "demo" },
  });
  return {
    ...record.payload,
    revision: record.revision,
    requests: record.payload.requests.map((r) => ({
      ...r,
      status: requestStatus(r),
    })),
  };
};
export const saveState = (db, state) =>
  db.workspace.update({
    where: { id: "demo" },
    data: { payload: state, revision: state.revision },
  });
export const fromRecord = (row) =>
  row ? { id: row.id, ...row.payload } : null;
export const version = async (db, id) =>
  id
    ? fromRecord(await db.scheduleVersion.findUnique({ where: { id } }))
    : null;
export const currentAssignments = async (db, state) =>
  (await version(db, state.currentVersion))?.assignments || [];
export async function saveVersion(db, v) {
  const { id, ...payload } = v;
  return fromRecord(
    await db.scheduleVersion.update({ where: { id }, data: { payload } }),
  );
}
export async function audit(db, kind, fields = {}) {
  const payload = {
    at: new Date().toISOString(),
    kind,
    actor: "dispatcher",
    ...fields,
  };
  await db.auditEvent.create({ data: { payload } });
  const { versionId, revision, requestId, technicianId, agentStatus } = fields;
  console.info(
    JSON.stringify({
      event: kind,
      at: payload.at,
      versionId,
      revision,
      requestId,
      technicianId,
      agentStatus,
    }),
  );
}
export function transaction(fn, db = prisma) {
  // Serialized workspace writes: approval, input mutation, version, audit, and outbox commit together.
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = 'demo' FOR UPDATE`;
      return fn(tx);
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      timeout: 10000,
    },
  );
}
