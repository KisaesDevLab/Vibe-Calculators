-- Phase 25.8 — backup audit actions + entity kind.
--
-- Adds three enum values used by the restore wizard:
--   audit_action: 'backup.created', 'backup.restore.requested'
--   audit_entity_kind: 'backup'

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'backup.created';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'backup.restore.requested';
ALTER TYPE "audit_entity_kind" ADD VALUE IF NOT EXISTS 'backup';
