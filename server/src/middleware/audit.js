import prisma from '../config/prisma.js';

const AUDITED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function actionFromMethod(method) {
  if (method === 'POST') return 'create';
  if (method === 'DELETE') return 'delete';
  return 'update';
}

/**
 * Пишет AuditLog при успешных POST/PUT/PATCH/DELETE.
 * entityId берётся из res.locals.audit.entityId (или req.params.id),
 * имя сущности — из res.locals.audit.entity (или аргумента).
 */
export function audit(entity) {
  return function auditMiddleware(req, res, next) {
    if (AUDITED_METHODS.has(req.method)) {
      res.on('finish', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return;

        const entityId = res.locals.audit?.entityId ?? req.params?.id ?? null;
        const entityName = res.locals.audit?.entity ?? entity;

        prisma.auditLog
          .create({
            data: {
              userId: req.user?.id ?? null,
              action: actionFromMethod(req.method),
              entity: entityName,
              entityId,
            },
          })
          .catch((error) => console.error('[audit] failed:', error.message));
      });
    }

    next();
  };
}
