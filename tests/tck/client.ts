import assert from "node:assert/strict";
import type { TckConfig } from "./config.js";
import { recordComparisonServerRetry } from "./comparison.js";

export interface CmisProperty<T = unknown> {
  value: T;
}

export interface CmisObject {
  properties: Record<string, CmisProperty | undefined>;
}

export interface CmisClient {
  createDocumentWithoutContent(parentObjectId: string, name: string): Promise<CmisObject>;
  createDocument(parentObjectId: string, name: string, content: string, contentType?: string): Promise<CmisObject>;
  createDocumentStatus(parentObjectId: string, name: string, content: string, contentType?: string): Promise<{ status: number; payload: Record<string, unknown> }>;
  createFolder(parentObjectId: string, name: string): Promise<CmisObject>;
  createFolderStatus(parentObjectId: string, name: string): Promise<{ status: number; payload: Record<string, unknown> }>;
  createFolderWithTypeStatus(parentObjectId: string, name: string, objectTypeId: string): Promise<{ status: number; payload: Record<string, unknown> }>;
  createItem(parentObjectId: string, name: string, url: string): Promise<CmisObject>;
  deleteTree(objectId: string): Promise<{ ids?: string[] }>;
  deleteObject(objectId: string): Promise<void>;
  getContentStreamStatus(objectId: string): Promise<number>;
  getObject(objectId: string, params?: Record<string, string>): Promise<Record<string, unknown>>;
  getObjectStatus(objectId: string): Promise<number>;
  getChildren(folderObjectId: string, params?: Record<string, string>): Promise<Record<string, unknown>>;
  getProperties(objectId: string, filter?: string): Promise<Record<string, CmisProperty | undefined>>;
  getContentText(objectId: string): Promise<string>;
  updateName(objectId: string, name: string): Promise<CmisObject>;
  setContent(objectId: string, content: string, contentType?: string): Promise<CmisObject>;
  deleteContentStatus(objectId: string): Promise<{ status: number; payload: Record<string, unknown> }>;
  bulkUpdateNames(objectIds: string[], name: string): Promise<Array<Record<string, unknown>>>;
  updateNameStatus(objectId: string, name: string, changeToken?: string): Promise<{ status: number; payload: Record<string, unknown> }>;
  getContentRange(objectId: string, range: string): Promise<{ status: number; text: string; contentRange: string | null }>;
  copyDocument(sourceId: string, targetFolderId: string, name: string): Promise<CmisObject>;
  moveObject(objectId: string, sourceFolderId: string, targetFolderId: string): Promise<CmisObject>;
  createRelationship(sourceId: string, targetId: string, relationshipId: string, name: string): Promise<CmisObject>;
  deleteRelationship(sourceId: string, relationshipId: string): Promise<void>;
  deleteRelationshipStatus(sourceId: string, relationshipId: string): Promise<{ status: number; payload: Record<string, unknown> }>;
  actionStatus(targetObjectId: string, action: string, fields?: Record<string, string>): Promise<{ status: number; payload: Record<string, unknown> }>;
  query(statement: string, params?: Record<string, string>): Promise<Record<string, unknown>>;
  queryStatus(statement: string, params?: Record<string, string>): Promise<{ status: number; payload: Record<string, unknown> }>;
  getContentChanges(changeLogToken: string, params?: Record<string, string>): Promise<Record<string, unknown>>;
}

export function createCmisClient(config: TckConfig): CmisClient {
  const repositoryBaseUrl = `${config.baseUrl.replace(/\/+$/, "")}/${encodeURIComponent(config.repositoryId)}`;

  return {
    async createDocumentWithoutContent(parentObjectId: string, name: string): Promise<CmisObject> {
      const form = new URLSearchParams({
        cmisaction: "createDocument",
        "propertyId[0]": "cmis:objectTypeId",
        "propertyValue[0]": "cmis:document",
        "propertyId[1]": "cmis:name",
        "propertyValue[1]": name
      });
      return postCmisObject(repositoryBaseUrl, `/object/${encodeURIComponent(parentObjectId)}`, form, 201);
    },

    async createDocument(parentObjectId: string, name: string, content: string, contentType?: string): Promise<CmisObject> {
      const form = new URLSearchParams({
        cmisaction: "createDocument",
        "propertyId[0]": "cmis:objectTypeId",
        "propertyValue[0]": "cmis:document",
        "propertyId[1]": "cmis:name",
        "propertyValue[1]": name,
        content
      });
      if (contentType) {
        form.set("contentType", contentType);
      }
      return postCmisObject(repositoryBaseUrl, `/object/${encodeURIComponent(parentObjectId)}`, form, 201);
    },

    async createDocumentStatus(parentObjectId, name, content, contentType) {
      const form = createDocumentForm(name, content, contentType);
      return postCmisStatus(repositoryBaseUrl, `/object/${encodeURIComponent(parentObjectId)}`, form);
    },

    async createFolder(parentObjectId: string, name: string): Promise<CmisObject> {
      const form = new URLSearchParams({
        cmisaction: "createFolder",
        "propertyId[0]": "cmis:objectTypeId",
        "propertyValue[0]": "cmis:folder",
        "propertyId[1]": "cmis:name",
        "propertyValue[1]": name
      });
      return postCmisObject(repositoryBaseUrl, `/object/${encodeURIComponent(parentObjectId)}`, form, 201);
    },

    async createFolderStatus(parentObjectId, name) {
      const form = new URLSearchParams({
        cmisaction: "createFolder",
        "propertyId[0]": "cmis:objectTypeId",
        "propertyValue[0]": "cmis:folder",
        "propertyId[1]": "cmis:name",
        "propertyValue[1]": name
      });
      return postCmisStatus(repositoryBaseUrl, `/object/${encodeURIComponent(parentObjectId)}`, form);
    },

    async createFolderWithTypeStatus(parentObjectId: string, name: string, objectTypeId: string) {
      const form = new URLSearchParams({
        cmisaction: "createFolder",
        "propertyId[0]": "cmis:objectTypeId",
        "propertyValue[0]": objectTypeId,
        "propertyId[1]": "cmis:name",
        "propertyValue[1]": name
      });
      const response = await fetchCmis(`${repositoryBaseUrl}/object/${encodeURIComponent(parentObjectId)}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form
      });
      const text = await response.text();
      return { status: response.status, payload: text ? JSON.parse(text) as Record<string, unknown> : {} };
    },

    async createItem(parentObjectId: string, name: string, url: string): Promise<CmisObject> {
      const form = new URLSearchParams({
        cmisaction: "createItem",
        "propertyId[0]": "cmis:objectTypeId",
        "propertyValue[0]": "cmis:item",
        "propertyId[1]": "cmis:name",
        "propertyValue[1]": name,
        "propertyId[2]": "box:webLinkUrl",
        "propertyValue[2]": url
      });
      return postCmisObject(repositoryBaseUrl, `/object/${encodeURIComponent(parentObjectId)}`, form, 201);
    },

    async deleteTree(objectId: string): Promise<{ ids?: string[] }> {
      const form = new URLSearchParams({
        cmisaction: "deleteTree",
        objectId,
        allVersions: "true",
        continueOnFailure: "true"
      });
      return postCmis(repositoryBaseUrl, `/object/${encodeURIComponent(objectId)}`, form, 200) as Promise<{ ids?: string[] }>;
    },

    async deleteObject(objectId: string): Promise<void> {
      const form = new URLSearchParams({
        cmisaction: "deleteObject",
        objectId,
        allVersions: "true"
      });
      await postCmis(repositoryBaseUrl, `/object/${encodeURIComponent(objectId)}`, form, 200);
    },

    async getContentStreamStatus(objectId: string): Promise<number> {
      const params = new URLSearchParams({
        objectId,
        cmisselector: "content"
      });
      const response = await fetchCmis(`${repositoryBaseUrl}/root?${params.toString()}`);
      await response.body?.cancel();
      return response.status;
    },

    async getObject(objectId: string, params: Record<string, string> = {}): Promise<Record<string, unknown>> {
      return getCmisJson(repositoryBaseUrl, {
        objectId,
        cmisselector: "object",
        ...params
      });
    },

    async getObjectStatus(objectId: string): Promise<number> {
      const params = new URLSearchParams({
        objectId,
        cmisselector: "object"
      });
      const response = await fetchCmis(`${repositoryBaseUrl}/root?${params.toString()}`);
      await response.body?.cancel();
      return response.status;
    },

    async getChildren(folderObjectId: string, params: Record<string, string> = {}): Promise<Record<string, unknown>> {
      return getCmisJson(repositoryBaseUrl, {
        objectId: folderObjectId,
        cmisselector: "children",
        ...params
      });
    },

    async getProperties(objectId: string, filter?: string): Promise<Record<string, CmisProperty | undefined>> {
      const params = new URLSearchParams({
        objectId,
        cmisselector: "properties"
      });
      if (filter) {
        params.set("filter", filter);
      }

      const response = await fetchCmis(`${repositoryBaseUrl}/root?${params.toString()}`);
      if (response.status !== 200) {
        assert.fail(await response.text());
      }
      return response.json() as Promise<Record<string, CmisProperty | undefined>>;
    },

    async getContentText(objectId) {
      const query = new URLSearchParams({ objectId, cmisselector: "content" });
      const response = await fetchCmis(`${repositoryBaseUrl}/root?${query.toString()}`);
      const text = await response.text();
      assert.equal(response.status, 200, text);
      return text;
    },

    async updateName(objectId, name) {
      const form = new URLSearchParams({
        cmisaction: "updateProperties",
        "propertyId[0]": "cmis:name",
        "propertyValue[0]": name
      });
      return postCmisObject(repositoryBaseUrl, `/object/${encodeURIComponent(objectId)}`, form, 200);
    },

    async setContent(objectId, content, contentType) {
      const form = new URLSearchParams({ cmisaction: "setContentStream", overwriteFlag: "true", content });
      if (contentType) form.set("contentType", contentType);
      return postCmisObject(repositoryBaseUrl, `/object/${encodeURIComponent(objectId)}`, form, 200);
    },

    async deleteContentStatus(objectId) {
      const form = new URLSearchParams({ cmisaction: "deleteContentStream" });
      return postCmisStatus(repositoryBaseUrl, `/object/${encodeURIComponent(objectId)}`, form);
    },

    async bulkUpdateNames(objectIds, name) {
      const form = new URLSearchParams({
        cmisaction: "bulkUpdateProperties",
        "propertyId[0]": "cmis:name",
        "propertyValue[0]": name
      });
      objectIds.forEach((objectId, index) => form.set(`objectId[${index}]`, objectId));
      return postCmis(repositoryBaseUrl, "", form, 200) as Promise<Array<Record<string, unknown>>>;
    },

    async updateNameStatus(objectId, name, changeToken) {
      const form = new URLSearchParams({ cmisaction: "updateProperties", "propertyId[0]": "cmis:name", "propertyValue[0]": name });
      if (changeToken) form.set("changeToken", changeToken);
      return postCmisStatus(repositoryBaseUrl, `/object/${encodeURIComponent(objectId)}`, form);
    },

    async getContentRange(objectId, range) {
      const query = new URLSearchParams({ objectId, cmisselector: "content" });
      const response = await fetchCmis(`${repositoryBaseUrl}/root?${query.toString()}`, { headers: { range } });
      return { status: response.status, text: await response.text(), contentRange: response.headers.get("content-range") };
    },

    async copyDocument(sourceId, targetFolderId, name) {
      const form = new URLSearchParams({ cmisaction: "createDocumentFromSource", sourceId, name });
      return postCmisObject(repositoryBaseUrl, `/object/${encodeURIComponent(targetFolderId)}`, form, 201);
    },

    async moveObject(objectId, sourceFolderId, targetFolderId) {
      const form = new URLSearchParams({ cmisaction: "moveObject", objectId, sourceFolderId, targetFolderId });
      return postCmisObject(repositoryBaseUrl, `/object/${encodeURIComponent(objectId)}`, form, 200);
    },

    async createRelationship(sourceId, targetId, relationshipId, name) {
      const form = new URLSearchParams({ cmisaction: "createRelationship", sourceId, targetId, relationshipId, "cmis:name": name });
      return postCmisObject(repositoryBaseUrl, `/object/${encodeURIComponent(sourceId)}`, form, 201);
    },

    async deleteRelationship(sourceId, relationshipId) {
      const form = new URLSearchParams({ cmisaction: "deleteRelationship", sourceId, relationshipId });
      await postCmis(repositoryBaseUrl, `/object/${encodeURIComponent(sourceId)}`, form, 200);
    },

    async deleteRelationshipStatus(sourceId, relationshipId) {
      const form = new URLSearchParams({ cmisaction: "deleteRelationship", sourceId, relationshipId });
      return postCmisStatus(repositoryBaseUrl, `/object/${encodeURIComponent(sourceId)}`, form);
    },

    async actionStatus(targetObjectId, action, fields = {}) {
      const form = new URLSearchParams({ cmisaction: action, ...fields });
      return postCmisStatus(repositoryBaseUrl, `/object/${encodeURIComponent(targetObjectId)}`, form);
    },

    async query(statement, params = {}) {
      return getRepositoryCmisJson(repositoryBaseUrl, { cmisselector: "query", statement, ...params });
    },

    async queryStatus(statement, params = {}) {
      const query = new URLSearchParams({ cmisselector: "query", statement, ...params });
      const response = await fetchCmis(`${repositoryBaseUrl}?${query.toString()}`);
      const text = await response.text();
      return { status: response.status, payload: text ? JSON.parse(text) as Record<string, unknown> : {} };
    },

    async getContentChanges(changeLogToken, params = {}) {
      return getRepositoryCmisJson(repositoryBaseUrl, { cmisselector: "contentChanges", changeLogToken, ...params });
    }
  };
}

async function getRepositoryCmisJson(repositoryBaseUrl: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const query = new URLSearchParams(params);
  const response = await fetchCmis(`${repositoryBaseUrl}?${query.toString()}`);
  const text = await response.text();
  assert.equal(response.status, 200, text);
  return text ? JSON.parse(text) as Record<string, unknown> : {};
}

function createDocumentForm(name: string, content: string, contentType?: string): URLSearchParams {
  const form = new URLSearchParams({
    cmisaction: "createDocument",
    "propertyId[0]": "cmis:objectTypeId",
    "propertyValue[0]": "cmis:document",
    "propertyId[1]": "cmis:name",
    "propertyValue[1]": name,
    content
  });
  if (contentType) form.set("contentType", contentType);
  return form;
}

export function propertyValue<T = unknown>(object: CmisObject, propertyId: string): T | undefined {
  return object.properties[propertyId]?.value as T | undefined;
}

async function postCmisObject(repositoryBaseUrl: string, path: string, form: URLSearchParams, expectedStatus: number): Promise<CmisObject> {
  const payload = await postCmis(repositoryBaseUrl, path, form, expectedStatus);
  assert.ok(isCmisObject(payload), "Expected CMIS object response");
  return payload;
}

async function postCmis(repositoryBaseUrl: string, path: string, form: URLSearchParams, expectedStatus: number): Promise<unknown> {
  const response = await fetchCmis(`${repositoryBaseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form
  });

  const text = await response.text();
  assert.equal(response.status, expectedStatus, text);
  return text ? JSON.parse(text) as unknown : {};
}

async function postCmisStatus(repositoryBaseUrl: string, path: string, form: URLSearchParams): Promise<{ status: number; payload: Record<string, unknown> }> {
  const response = await fetchCmis(`${repositoryBaseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form
  });
  const text = await response.text();
  return { status: response.status, payload: text ? JSON.parse(text) as Record<string, unknown> : {} };
}

async function getCmisJson(repositoryBaseUrl: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const query = new URLSearchParams(params);
  const response = await fetchCmis(`${repositoryBaseUrl}/root?${query.toString()}`);
  const text = await response.text();
  assert.equal(response.status, 200, text);
  return text ? JSON.parse(text) as Record<string, unknown> : {};
}

function isCmisObject(value: unknown): value is CmisObject {
  return typeof value === "object" && value !== null && "properties" in value;
}

async function fetchCmis(input: string | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init);
  const retryCount = Number(response.headers.get("x-box-cmis-box-sdk-retry-count"));
  if (Number.isInteger(retryCount) && retryCount > 0) {
    recordComparisonServerRetry(retryCount);
  }
  return response;
}
