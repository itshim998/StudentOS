import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const tokenStore = new Map();
const PROVIDER = "google_classroom";

function nowIso(now = new Date()) {
  return now.toISOString();
}

function expiryFromToken(token = {}, now = new Date()) {
  const seconds = Number(token.expires_in || token.expiresIn || 0);
  return seconds > 0 ? new Date(now.getTime() + seconds * 1000).toISOString() : null;
}

function scopeList(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  return String(value || "")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function deriveKey(secret) {
  if (!secret) return null;
  return createHash("sha256").update(String(secret)).digest();
}

export function encryptClassroomTokenValue(value, config = {}) {
  if (!value) return null;
  const key = deriveKey(config.tokenEncryptionSecret);
  if (!key) {
    const error = new Error("Google Classroom token encryption is not configured");
    error.status = 503;
    throw error;
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

export function decryptClassroomTokenValue(value, config = {}) {
  if (!value) return null;
  const [version, ivText, tagText, encryptedText] = String(value).split(":");
  if (version !== "v1" || !ivText || !tagText || !encryptedText) {
    const error = new Error("Google Classroom token payload is invalid");
    error.status = 500;
    throw error;
  }
  const key = deriveKey(config.tokenEncryptionSecret);
  if (!key) {
    const error = new Error("Google Classroom token decryption is not configured");
    error.status = 503;
    throw error;
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function normalizedTokenRecord(userId, token, { now = new Date(), providerAccountEmail = "", existing = null, refreshed = false } = {}) {
  if (!userId || !token?.access_token) {
    const error = new Error("Google Classroom token storage requires a user id and access token");
    error.status = 400;
    throw error;
  }
  const createdAt = existing?.createdAt || existing?.tokenCreatedAt || nowIso(now);
  return {
    id: `classroom_token_${userId}`,
    userId,
    provider: PROVIDER,
    accessToken: token.access_token,
    refreshToken: token.refresh_token || existing?.refreshToken || null,
    tokenType: token.token_type || existing?.tokenType || "Bearer",
    scopes: scopeList(token.scope || existing?.scope || existing?.scopes || ""),
    providerAccountEmail: providerAccountEmail || existing?.providerAccountEmail || null,
    expiresAt: expiryFromToken(token, now) || existing?.expiresAt || null,
    refreshExpiresAt: existing?.refreshExpiresAt || null,
    connectedAt: existing?.connectedAt || createdAt,
    createdAt,
    updatedAt: nowIso(now),
    lastRefreshAt: refreshed ? nowIso(now) : existing?.lastRefreshAt || null,
    status: "connected",
    tokenStorage: "session_memory_only",
  };
}

function persistentRowFromTokenRecord(record, config = {}) {
  return {
    id: record.id,
    userId: record.userId,
    provider: PROVIDER,
    providerAccountEmail: record.providerAccountEmail || null,
    scopes: record.scopes || [],
    tokenStatus: record.status || "connected",
    encryptedAccessToken: encryptClassroomTokenValue(record.accessToken, config),
    encryptedRefreshToken: encryptClassroomTokenValue(record.refreshToken, config),
    encryptionKeyId: config.tokenEncryptionKeyId || "studentos-google-classroom-token-v1",
    tokenCreatedAt: record.createdAt || nowIso(),
    tokenUpdatedAt: record.updatedAt || nowIso(),
    accessExpiresAt: record.expiresAt || null,
    refreshExpiresAt: record.refreshExpiresAt || null,
    lastRefreshAt: record.lastRefreshAt || null,
    lastError: null,
    payload: {
      tokenType: record.tokenType || "Bearer",
      storageMode: "encrypted_shard_storage",
      writebackEnabled: false,
      secretsExposed: false,
    },
  };
}

export function tokenRecordFromPersistentRow(row, config = {}, now = new Date()) {
  if (!row) return null;
  const accessToken = decryptClassroomTokenValue(row.encryptedAccessToken || row.encrypted_access_token, config);
  const refreshToken = decryptClassroomTokenValue(row.encryptedRefreshToken || row.encrypted_refresh_token, config);
  const expiresAt = row.accessExpiresAt || row.access_expires_at || null;
  return {
    id: row.id,
    userId: row.userId || row.user_id,
    provider: row.provider || PROVIDER,
    accessToken,
    refreshToken,
    tokenType: row.payload?.tokenType || row.payload?.token_type || "Bearer",
    scopes: row.scopes || [],
    providerAccountEmail: row.providerAccountEmail || row.provider_account_email || null,
    expiresAt,
    refreshExpiresAt: row.refreshExpiresAt || row.refresh_expires_at || null,
    connectedAt: row.createdAt || row.created_at || null,
    createdAt: row.tokenCreatedAt || row.token_created_at || row.createdAt || row.created_at || null,
    updatedAt: row.tokenUpdatedAt || row.token_updated_at || row.updatedAt || row.updated_at || null,
    lastRefreshAt: row.lastRefreshAt || row.last_refresh_at || null,
    lastError: row.lastError || row.last_error || null,
    status: row.tokenStatus || row.token_status || "connected",
    tokenStorage: "encrypted_shard_storage",
    expired: expiresAt ? Date.parse(expiresAt) <= now.getTime() : false,
  };
}

export function saveClassroomToken(userId, token, now = new Date()) {
  const record = normalizedTokenRecord(userId, token, { now });
  tokenStore.set(userId, record);
  return safeClassroomTokenMetadata(record);
}

export function getClassroomToken(userId, now = new Date()) {
  const record = tokenStore.get(userId);
  if (!record) return null;
  const expired = record.expiresAt && Date.parse(record.expiresAt) <= now.getTime();
  return { ...record, expired: Boolean(expired) };
}

export function deleteClassroomToken(userId) {
  return tokenStore.delete(userId);
}

export async function savePersistentClassroomToken({ session, repository, token, config, now = new Date(), providerAccountEmail = "", refreshed = false } = {}) {
  if (!repository?.saveClassroomToken || !session?.user?.id || !config?.tokenEncryptionSecret) {
    return saveClassroomToken(session?.user?.id, token, now);
  }
  const existing = await getPersistentClassroomToken({ session, repository, config, now }).catch(() => null);
  const record = normalizedTokenRecord(session.user.id, token, { now, providerAccountEmail, existing, refreshed });
  await repository.saveClassroomToken(session, persistentRowFromTokenRecord(record, config));
  return safeClassroomTokenMetadata({ ...record, tokenStorage: "encrypted_shard_storage" });
}

export async function getPersistentClassroomToken({ session, repository, config, now = new Date() } = {}) {
  if (repository?.getClassroomToken && session?.user?.id && config?.tokenEncryptionSecret) {
    const row = await repository.getClassroomToken(session);
    if (row) return tokenRecordFromPersistentRow(row, config, now);
  }
  return getClassroomToken(session?.user?.id, now);
}

export async function deletePersistentClassroomToken({ session, repository } = {}) {
  if (repository?.deleteClassroomToken && session?.user?.id) {
    await repository.deleteClassroomToken(session);
  }
  return deleteClassroomToken(session?.user?.id);
}

export async function markPersistentClassroomTokenStatus({ session, repository, status, lastError = "", now = new Date() } = {}) {
  if (repository?.markClassroomTokenStatus && session?.user?.id) {
    await repository.markClassroomTokenStatus(session, {
      status,
      lastError,
      updatedAt: nowIso(now),
    });
  }
}

export function safeClassroomTokenMetadata(record = {}) {
  return {
    connectedAt: record.connectedAt || record.createdAt || null,
    updatedAt: record.updatedAt || null,
    expiresAt: record.expiresAt || null,
    refreshExpiresAt: record.refreshExpiresAt || null,
    providerAccountEmail: record.providerAccountEmail || null,
    scopes: record.scopes || scopeList(record.scope),
    status: record.status || (record.expired ? "expired" : "connected"),
    hasAccessToken: Boolean(record.accessToken || record.encryptedAccessToken || record.encrypted_access_token),
    hasRefreshToken: Boolean(record.refreshToken || record.encryptedRefreshToken || record.encrypted_refresh_token),
    tokenStorage: record.tokenStorage || "session_memory_only",
    encryptedAtRest: record.tokenStorage === "encrypted_shard_storage" ||
      Boolean(record.encryptedAccessToken || record.encrypted_access_token),
    secretsExposed: false,
  };
}
