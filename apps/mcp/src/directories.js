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

export function handleDirectoryError(err) {
  if ([400, 404, 409].includes(err.statusCode)) return businessError(err.message);
  if (err.code === "DIRECTORY_NOT_FOUND") return businessError("Directory not found");
  if (err.code === "DIRECTORY_EXISTS") return businessError("Directory already exists");
  if (err.code === "DIRECTORY_NOT_EMPTY") return businessError("Directory is not empty");
  if (err.code === "DIRECTORY_CYCLE") return businessError(err.message);
  return databaseError(err);
}
