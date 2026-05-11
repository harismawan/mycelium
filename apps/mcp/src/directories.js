import { prisma } from "./db.js";

export function toDirectorySummary(directory) {
  if (!directory) return null;
  return {
    id: directory.id,
    name: directory.name,
    parentId: directory.parentId,
  };
}

export function toDirectoryTreeNode(directory) {
  return {
    id: directory.id,
    name: directory.name,
    parentId: directory.parentId,
    noteCount: directory._count?.notes ?? 0,
    children: [],
  };
}

export function toDirectoryResponse(directory) {
  return {
    id: directory.id,
    name: directory.name,
    parentId: directory.parentId,
    createdAt: directory.createdAt?.toISOString?.() ?? directory.createdAt,
    updatedAt: directory.updatedAt?.toISOString?.() ?? directory.updatedAt,
  };
}

export function businessError(message, details = {}) {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: message, ...details }) }],
    isError: true,
  };
}

export function databaseError(err) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          error: "Database error",
          message: err.message,
          isRetryable: true,
        }),
      },
    ],
    isError: true,
  };
}

export async function ensureDirectory(userId, directoryId, tx = prisma) {
  if (directoryId == null) return null;
  const directory = await tx.directory.findFirst({
    where: { id: directoryId, userId },
    select: { id: true, name: true, parentId: true },
  });
  if (!directory) {
    throw Object.assign(new Error("Directory not found"), { code: "DIRECTORY_NOT_FOUND" });
  }
  return directory;
}

export async function ensureUniqueSibling(userId, name, parentId, excludeId, tx = prisma) {
  const existing = await tx.directory.findFirst({
    where: {
      userId,
      name,
      parentId,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });
  if (existing) {
    throw Object.assign(new Error("Directory already exists"), { code: "DIRECTORY_EXISTS" });
  }
}

export async function findOrCreateMemoriesDirectory(userId, tx = prisma) {
  const existing = await tx.directory.findFirst({
    where: { userId, parentId: null, name: "memories" },
    select: { id: true },
  });
  if (existing) return existing;

  return tx.directory.create({
    data: { name: "memories", parentId: null, userId },
    select: { id: true },
  });
}

export function handleDirectoryError(err) {
  if (err.code === "DIRECTORY_NOT_FOUND") return businessError("Directory not found");
  if (err.code === "DIRECTORY_EXISTS") return businessError("Directory already exists");
  if (err.code === "DIRECTORY_NOT_EMPTY") return businessError("Directory is not empty");
  if (err.code === "DIRECTORY_CYCLE") return businessError(err.message);
  return databaseError(err);
}
