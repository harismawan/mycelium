import { prisma } from "./db.js";
import { log } from "./logger.js";

/**
 * Persist MCP tool activity into ActivityLog table.
 * Never throws to caller.
 *
 * @param {{ userId: string, apiKeyId: string, apiKeyName: string }} auth
 * @param {{ action: string, status?: 'success'|'error', targetResourceId?: string|null, targetResourceSlug?: string|null, details?: Record<string, unknown> }} event
 */
export async function logMcpAction(auth, event) {
  try {
    await prisma.activityLog.create({
      data: {
        userId: auth.userId,
        apiKeyId: auth.apiKeyId,
        apiKeyName: auth.apiKeyName,
        action: event.action,
        targetResourceId: event.targetResourceId ?? null,
        targetResourceSlug: event.targetResourceSlug ?? null,
        details: event.details ?? {},
        status: event.status ?? "success",
      },
    });
  } catch (err) {
    log("warn", "activity.log.failed", {
      action: event.action,
      error: err?.message || String(err),
    });
  }
}
