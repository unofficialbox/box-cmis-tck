import assert from "node:assert/strict";
import type { TckConfig } from "./config.js";

export interface CmisProperty<T = unknown> {
  value: T;
}

export interface CmisObject {
  properties: Record<string, CmisProperty | undefined>;
}

export interface CmisClient {
  createDocumentWithoutContent(parentObjectId: string, name: string): Promise<CmisObject>;
  createDocument(parentObjectId: string, name: string, content: string, contentType?: string): Promise<CmisObject>;
  createFolder(parentObjectId: string, name: string): Promise<CmisObject>;
  deleteTree(objectId: string): Promise<{ ids?: string[] }>;
  deleteObject(objectId: string): Promise<void>;
  getContentStreamStatus(objectId: string): Promise<number>;
  getObjectStatus(objectId: string): Promise<number>;
  getProperties(objectId: string, filter?: string): Promise<Record<string, CmisProperty | undefined>>;
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
      const response = await fetch(`${repositoryBaseUrl}/root?${params.toString()}`);
      await response.body?.cancel();
      return response.status;
    },

    async getObjectStatus(objectId: string): Promise<number> {
      const params = new URLSearchParams({
        objectId,
        cmisselector: "object"
      });
      const response = await fetch(`${repositoryBaseUrl}/root?${params.toString()}`);
      await response.body?.cancel();
      return response.status;
    },

    async getProperties(objectId: string, filter?: string): Promise<Record<string, CmisProperty | undefined>> {
      const params = new URLSearchParams({
        objectId,
        cmisselector: "properties"
      });
      if (filter) {
        params.set("filter", filter);
      }

      const response = await fetch(`${repositoryBaseUrl}/root?${params.toString()}`);
      if (response.status !== 200) {
        assert.fail(await response.text());
      }
      return response.json() as Promise<Record<string, CmisProperty | undefined>>;
    }
  };
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
  const response = await fetch(`${repositoryBaseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form
  });

  const text = await response.text();
  assert.equal(response.status, expectedStatus, text);
  return text ? JSON.parse(text) as unknown : {};
}

function isCmisObject(value: unknown): value is CmisObject {
  return typeof value === "object" && value !== null && "properties" in value;
}
