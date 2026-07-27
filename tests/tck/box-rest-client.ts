import assert from "node:assert/strict";
import type { TckConfig } from "./config.js";
import { recordComparisonRetry } from "./comparison.js";

export interface BoxRestItem {
  id: string;
  type: "file" | "folder" | "web_link";
  name?: string;
  size?: number;
}

export interface BoxRestItemsPage {
  entries: BoxRestItem[];
  total_count: number;
  limit?: number;
  offset?: number;
}

export interface BoxRestEvent {
  event_id?: string;
  event_type?: string;
  created_at?: string;
  source?: { id?: string; type?: string; name?: string };
}

export interface BoxRestEventsPage {
  entries: BoxRestEvent[];
  next_stream_position?: string | number;
  chunk_size?: number;
}

export interface BoxRestClient {
  createFolder(parentFolderId: string, name: string): Promise<BoxRestItem>;
  createFolderStatus(parentFolderId: string, name: string): Promise<{ status: number; payload: Record<string, unknown> }>;
  uploadFile(parentFolderId: string, name: string, content: string, contentType?: string): Promise<BoxRestItem>;
  uploadFileStatus(parentFolderId: string, name: string, content: string, contentType?: string): Promise<{ status: number; payload: Record<string, unknown> }>;
  createWebLink(parentFolderId: string, name: string, url: string): Promise<BoxRestItem>;
  getFile(fileId: string): Promise<BoxRestItem>;
  getFileFields(fileId: string, fields: string[]): Promise<Record<string, unknown>>;
  getFolder(folderId: string): Promise<BoxRestItem>;
  listFolderItems(folderId: string, options?: { fields?: string[]; limit?: number; offset?: number; sort?: string; direction?: "ASC" | "DESC" }): Promise<BoxRestItemsPage>;
  getWebLink(webLinkId: string): Promise<BoxRestItem & { url?: string }>;
  getFileStatus(fileId: string): Promise<number>;
  getFolderStatus(folderId: string): Promise<number>;
  getFileContentStatus(fileId: string): Promise<number>;
  getFileContentText(fileId: string): Promise<string>;
  updateFileName(fileId: string, name: string): Promise<BoxRestItem>;
  updateFileNameStatus(fileId: string, name: string): Promise<{ status: number; payload: Record<string, unknown> }>;
  replaceFileContent(fileId: string, name: string, content: string, contentType?: string): Promise<BoxRestItem>;
  updateFileNameWithEtag(fileId: string, name: string, etag: string): Promise<{ status: number; payload: Record<string, unknown> }>;
  getFileContentRange(fileId: string, range: string): Promise<{ status: number; text: string; contentRange: string | null }>;
  copyFile(fileId: string, parentFolderId: string, name: string): Promise<BoxRestItem>;
  moveFile(fileId: string, parentFolderId: string): Promise<BoxRestItem>;
  createFileMetadata(fileId: string, scope: string, templateKey: string, values: Record<string, unknown>): Promise<{ status: number; payload: Record<string, unknown> }>;
  deleteFileMetadata(fileId: string, scope: string, templateKey: string): Promise<{ status: number; payload: Record<string, unknown> }>;
  getFileMetadata(fileId: string, scope: string, templateKey: string): Promise<{ status: number; payload: Record<string, unknown> }>;
  getClassificationTemplateStatus(): Promise<{ status: number; payload: Record<string, unknown> }>;
  getEvents(options?: { streamPosition?: string; limit?: number; streamType?: string }): Promise<BoxRestEventsPage>;
  deleteFile(fileId: string): Promise<void>;
  deleteFolder(folderId: string, recursive?: boolean): Promise<void>;
  deleteWebLink(webLinkId: string): Promise<void>;
}

export async function createBoxRestClient(config: TckConfig): Promise<BoxRestClient> {
  const accessToken = await acquireAccessToken(config);
  const apiBaseUrl = config.boxApiBaseUrl.replace(/\/+$/, "");
  const uploadBaseUrl = config.boxUploadBaseUrl.replace(/\/+$/, "");
  const authorization = `Bearer ${accessToken}`;

  async function jsonRequest<T>(url: string, init: RequestInit, expectedStatus: number): Promise<T> {
    const response = await fetchWithRetry(url, {
      ...init,
      headers: { authorization, ...init.headers }
    });
    const text = await response.text();
    assert.equal(response.status, expectedStatus, redact(text).slice(0, 1_000));
    return (text ? JSON.parse(text) : {}) as T;
  }

  return {
    createFolder(parentFolderId, name) {
      return jsonRequest<BoxRestItem>(`${apiBaseUrl}/2.0/folders`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, parent: { id: parentFolderId } })
      }, 201);
    },

    createFolderStatus(parentFolderId, name) {
      return statusRequest(`${apiBaseUrl}/2.0/folders`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, parent: { id: parentFolderId } })
      });
    },

    async uploadFile(parentFolderId, name, content, contentType = "text/plain") {
      const form = new FormData();
      form.set("attributes", JSON.stringify({ name, parent: { id: parentFolderId } }));
      form.set("file", new Blob([content], { type: contentType }), name);
      const payload = await jsonRequest<{ entries: BoxRestItem[] }>(`${uploadBaseUrl}/api/2.0/files/content`, {
        method: "POST",
        body: form
      }, 201);
      assert.ok(payload.entries[0], "Expected Box upload response entry");
      return payload.entries[0];
    },

    async uploadFileStatus(parentFolderId, name, content, contentType = "text/plain") {
      const form = new FormData();
      form.set("attributes", JSON.stringify({ name, parent: { id: parentFolderId } }));
      form.set("file", new Blob([content], { type: contentType }), name);
      return statusRequest(`${uploadBaseUrl}/api/2.0/files/content`, { method: "POST", body: form });
    },

    createWebLink(parentFolderId, name, url) {
      return jsonRequest<BoxRestItem>(`${apiBaseUrl}/2.0/web_links`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, url, parent: { id: parentFolderId } })
      }, 201);
    },

    getFile(fileId) {
      return jsonRequest<BoxRestItem>(`${apiBaseUrl}/2.0/files/${encodeURIComponent(fileId)}?fields=id,type,name,size`, {}, 200);
    },

    getFileFields(fileId, fields) {
      return jsonRequest<Record<string, unknown>>(`${apiBaseUrl}/2.0/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(fields.join(","))}`, {}, 200);
    },

    getFolder(folderId) {
      return jsonRequest<BoxRestItem>(`${apiBaseUrl}/2.0/folders/${encodeURIComponent(folderId)}?fields=id,type,name`, {}, 200);
    },

    listFolderItems(folderId, options = {}) {
      const query = new URLSearchParams({
        fields: (options.fields ?? ["id", "type", "name", "size"]).join(","),
        limit: String(options.limit ?? 100),
        offset: String(options.offset ?? 0)
      });
      if (options.sort) query.set("sort", options.sort);
      if (options.direction) query.set("direction", options.direction);
      return jsonRequest<BoxRestItemsPage>(`${apiBaseUrl}/2.0/folders/${encodeURIComponent(folderId)}/items?${query.toString()}`, {}, 200);
    },

    getWebLink(webLinkId) {
      return jsonRequest<BoxRestItem & { url?: string }>(`${apiBaseUrl}/2.0/web_links/${encodeURIComponent(webLinkId)}?fields=id,type,name,url`, {}, 200);
    },

    async getFileStatus(fileId) {
      const response = await fetch(`${apiBaseUrl}/2.0/files/${encodeURIComponent(fileId)}`, { headers: { authorization } });
      await response.body?.cancel();
      return response.status;
    },

    async getFolderStatus(folderId) {
      const response = await fetch(`${apiBaseUrl}/2.0/folders/${encodeURIComponent(folderId)}`, { headers: { authorization } });
      await response.body?.cancel();
      return response.status;
    },

    async getFileContentStatus(fileId) {
      const response = await fetch(`${apiBaseUrl}/2.0/files/${encodeURIComponent(fileId)}/content`, {
        headers: { authorization },
        redirect: "manual"
      });
      await response.body?.cancel();
      return response.status;
    },

    async getFileContentText(fileId) {
      const response = await fetchWithRetry(`${apiBaseUrl}/2.0/files/${encodeURIComponent(fileId)}/content`, {
        headers: { authorization }
      });
      const text = await response.text();
      assert.equal(response.status, 200, text.slice(0, 1_000));
      return text;
    },

    updateFileName(fileId, name) {
      return jsonRequest<BoxRestItem>(`${apiBaseUrl}/2.0/files/${encodeURIComponent(fileId)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name })
      }, 200);
    },

    updateFileNameStatus(fileId, name) {
      return statusRequest(`${apiBaseUrl}/2.0/files/${encodeURIComponent(fileId)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name })
      });
    },

    async replaceFileContent(fileId, name, content, contentType = "text/plain") {
      const form = new FormData();
      form.set("attributes", JSON.stringify({ name }));
      form.set("file", new Blob([content], { type: contentType }), name);
      const payload = await jsonRequest<{ entries: BoxRestItem[] }>(`${uploadBaseUrl}/api/2.0/files/${encodeURIComponent(fileId)}/content`, {
        method: "POST",
        body: form
      }, 201);
      assert.ok(payload.entries[0], "Expected Box upload-version response entry");
      return payload.entries[0];
    },

    updateFileNameWithEtag(fileId, name, etag) {
      return statusRequest(`${apiBaseUrl}/2.0/files/${encodeURIComponent(fileId)}`, {
        method: "PUT",
        headers: { "content-type": "application/json", "if-match": etag },
        body: JSON.stringify({ name })
      });
    },

    async getFileContentRange(fileId, range) {
      const response = await fetchWithRetry(`${apiBaseUrl}/2.0/files/${encodeURIComponent(fileId)}/content`, {
        headers: { authorization, range }
      });
      return { status: response.status, text: await response.text(), contentRange: response.headers.get("content-range") };
    },

    copyFile(fileId, parentFolderId, name) {
      return jsonRequest<BoxRestItem>(`${apiBaseUrl}/2.0/files/${encodeURIComponent(fileId)}/copy`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, parent: { id: parentFolderId } })
      }, 201);
    },

    moveFile(fileId, parentFolderId) {
      return jsonRequest<BoxRestItem>(`${apiBaseUrl}/2.0/files/${encodeURIComponent(fileId)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parent: { id: parentFolderId } })
      }, 200);
    },

    createFileMetadata(fileId, scope, templateKey, values) {
      return statusRequest(`${apiBaseUrl}/2.0/files/${encodeURIComponent(fileId)}/metadata/${encodeURIComponent(scope)}/${encodeURIComponent(templateKey)}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(values)
      });
    },

    deleteFileMetadata(fileId, scope, templateKey) {
      return statusRequest(`${apiBaseUrl}/2.0/files/${encodeURIComponent(fileId)}/metadata/${encodeURIComponent(scope)}/${encodeURIComponent(templateKey)}`, { method: "DELETE" });
    },

    getFileMetadata(fileId, scope, templateKey) {
      return statusRequest(`${apiBaseUrl}/2.0/files/${encodeURIComponent(fileId)}/metadata/${encodeURIComponent(scope)}/${encodeURIComponent(templateKey)}`, {});
    },

    getClassificationTemplateStatus() {
      return statusRequest(`${apiBaseUrl}/2.0/metadata_templates/enterprise/securityClassification-6VMVochwUWo/schema`, {});
    },

    getEvents(options = {}) {
      const query = new URLSearchParams({
        stream_type: options.streamType ?? "changes",
        stream_position: options.streamPosition ?? "now",
        limit: String(options.limit ?? 100)
      });
      return jsonRequest<BoxRestEventsPage>(`${apiBaseUrl}/2.0/events?${query.toString()}`, {}, 200);
    },

    async deleteFile(fileId) {
      await jsonRequest(`${apiBaseUrl}/2.0/files/${encodeURIComponent(fileId)}`, { method: "DELETE" }, 204);
    },

    async deleteFolder(folderId, recursive = false) {
      const query = recursive ? "?recursive=true" : "";
      await jsonRequest(`${apiBaseUrl}/2.0/folders/${encodeURIComponent(folderId)}${query}`, { method: "DELETE" }, 204);
    },

    async deleteWebLink(webLinkId) {
      await jsonRequest(`${apiBaseUrl}/2.0/web_links/${encodeURIComponent(webLinkId)}`, { method: "DELETE" }, 204);
    }
  };

  async function statusRequest(url: string, init: RequestInit): Promise<{ status: number; payload: Record<string, unknown> }> {
    const response = await fetchWithRetry(url, { ...init, headers: { authorization, ...init.headers } });
    const text = await response.text();
    let payload: Record<string, unknown> = {};
    if (text) {
      try {
        payload = JSON.parse(text) as Record<string, unknown>;
      } catch {
        payload = { message: redact(text).slice(0, 1_000) };
      }
    }
    return { status: response.status, payload };
  }

  async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    for (let attempt = 0; ; attempt += 1) {
      const response = await fetch(url, init);
      if (attempt >= 3 || (response.status !== 429 && response.status < 500)) return response;
      recordComparisonRetry();
      await response.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, 250 * (2 ** attempt)));
    }
  }
}

async function acquireAccessToken(config: TckConfig): Promise<string> {
  if (config.boxAccessToken) return config.boxAccessToken;
  assert.equal(config.boxAuthMode, "ccg", "Box REST comparison currently requires CCG or BOX_CMIS_TCK_BOX_ACCESS_TOKEN");
  assert.ok(config.boxClientId, "Expected BOX_CMIS_CCG_CLIENT_ID");
  assert.ok(config.boxClientSecret, "Expected BOX_CMIS_CCG_CLIENT_SECRET");
  const subjectId = config.boxCcgUserId ?? config.boxCcgEnterpriseId;
  assert.ok(subjectId, "Expected BOX_CMIS_CCG_USER_ID or BOX_CMIS_CCG_ENTERPRISE_ID");

  const form = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.boxClientId,
    client_secret: config.boxClientSecret,
    box_subject_type: config.boxCcgUserId ? "user" : "enterprise",
    box_subject_id: subjectId
  });
  const response = await fetch(config.boxTokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form
  });
  const text = await response.text();
  assert.equal(response.status, 200, redact(text));
  const payload = JSON.parse(text) as { access_token?: string };
  assert.ok(payload.access_token, "Expected Box access token response");
  return payload.access_token;
}

function redact(value: string): string {
  return value.replace(/"access_token"\s*:\s*"[^"]+"/g, '"access_token":"[REDACTED]"');
}
