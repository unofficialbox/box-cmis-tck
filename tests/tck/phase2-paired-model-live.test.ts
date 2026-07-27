import assert from "node:assert/strict";
import test from "node:test";
import { createBoxRestClient } from "./box-rest-client.js";
import { createCmisClient, propertyValue } from "./client.js";
import { createSideBySideComparison, measureOperation } from "./comparison.js";
import { readTckConfig, requireDestructiveTckConfig } from "./config.js";
import { buildFixtureName, buildRunId } from "./fixtures.js";
import { recordTimedResult } from "./report.js";

const config = readTckConfig();
const live = config.allowDestructive ? test : test.skip;

live("phase2.relationshipMutation compares CMIS relationships with Box metadata", { timeout: 120_000 }, async () => {
  requireDestructiveTckConfig(config);
  const root = config.runRootId ?? config.parentRootId; assert.ok(root);
  const template = (process.env.BOX_CMIS_RELATIONSHIP_TEMPLATE ?? "enterprise:cmisRelationships:relationships").split(":");
  const [scope, templateKey, propertyKey] = template; assert.ok(scope && templateKey && propertyKey);
  const cmis = createCmisClient(config); const box = await createBoxRestClient(config); const comparison = createSideBySideComparison(); const runId = buildRunId();
  const cmisIds: string[] = []; const boxIds: string[] = [];
  await recordTimedResult({runId:`${runId}-phase2-relationship-comparison`,reportDir:config.reportDir,phase:"phase2",testId:"phase2.relationshipMutationUnsupported",openCmisTests:["CreateAndDeleteRelationshipTest"],coverageMode:"equivalent",fixtureRootId:root,createdObjectCount:4,deletedObjectCount:4,cleanupStatus:"pass",details:{semanticDifference:"CMIS writes mirrored relationship metadata; direct Box REST comparison writes the configured source metadata instance",comparison}},async()=>{
    try {
      for (const side of ["source","target"]) { const c=await cmis.createDocument(`folder:${root}`,`${buildFixtureName(runId,"phase2",`rel-${side}-cmis`)}.txt`,side); const id=propertyValue<string>(c,"cmis:objectId"); assert.ok(id); cmisIds.push(id); const b=await box.uploadFile(root,`${buildFixtureName(runId,"phase2",`rel-${side}-box`)}.txt`,side); boxIds.push(b.id); }
      const relationshipId=`relationship:${cmisIds[0]}:${cmisIds[1]}:paired`;
      await measureOperation(comparison,"create-relationship","cmis",()=>cmis.createRelationship(cmisIds[0]!,cmisIds[1]!,relationshipId,"Paired relationship"),v=>({objectId:propertyValue(v,"cmis:objectId")}));
      await measureOperation(comparison,"read-relationship-metadata","box-rest",()=>box.getFileMetadata(cmisIds[0]!.replace(/^file:/,""),scope,templateKey),v=>({httpStatus:v.status,fields:Object.keys(v.payload),relationshipValue:v.payload[propertyKey]}));
      const entry={id:`relationship:${boxIds[0]}:${boxIds[1]}:paired`,sourceId:`file:${boxIds[0]}`,targetId:`file:${boxIds[1]}`,name:"Paired relationship",typeId:"cmis:relationship"};
      const created=await measureOperation(comparison,"create-relationship","box-rest",()=>box.createFileMetadata(boxIds[0]!,scope,templateKey,{[propertyKey]:JSON.stringify([entry])}),v=>({httpStatus:v.status})); assert.equal(created.status,201);
      await measureOperation(comparison,"delete-relationship","cmis",async()=>{
        const deadline=Date.now()+30_000;
        let result=await cmis.deleteRelationshipStatus(cmisIds[0]!,relationshipId);
        while(result.status===404&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,1_000));result=await cmis.deleteRelationshipStatus(cmisIds[0]!,relationshipId);}
        assert.equal(result.status,200,JSON.stringify(result.payload)); return result;
      },v=>({httpStatus:v.status}));
      const removed=await measureOperation(comparison,"delete-relationship","box-rest",()=>box.deleteFileMetadata(boxIds[0]!,scope,templateKey),v=>({httpStatus:v.status})); assert.equal(removed.status,204);
    } finally { await Promise.all(cmisIds.map(id=>cmis.deleteObject(id))); await Promise.all(boxIds.map(id=>box.deleteFile(id))); }
  });
});

live("phase2.policyMutationUnsupported compares generic policy models", { timeout: 30_000 }, async () => {
  requireDestructiveTckConfig(config); const root=config.runRootId??config.parentRootId; assert.ok(root);
  const cmis=createCmisClient(config); const box=await createBoxRestClient(config); const comparison=createSideBySideComparison(); const runId=buildRunId();
  await recordTimedResult({runId:`${runId}-phase2-policy-model-comparison`,reportDir:config.reportDir,phase:"phase2",testId:"phase2.policyMutationUnsupported",openCmisTests:["CreateAndDeletePolicyTest"],coverageMode:"expected-unsupported",fixtureRootId:root,createdObjectCount:0,deletedObjectCount:0,cleanupStatus:"skipped",details:{semanticDifference:"CMIS generic policy creation is unsupported; Box REST exposes enterprise Classification metadata rather than generic policy objects",comparison}},async()=>{
    const c=await measureOperation(comparison,"generic-policy-capability","cmis",()=>cmis.actionStatus(`folder:${root}`,"createPolicy",{"propertyId[0]":"cmis:name","propertyValue[0]":"TCK Policy"}),v=>({httpStatus:v.status,exception:v.payload.exception}));
    const b=await measureOperation(comparison,"generic-policy-capability","box-rest",()=>box.getClassificationTemplateStatus(),v=>({httpStatus:v.status,templateKey:v.payload.templateKey,interpretation:"read-only capability probe; no generic Box policy-object create endpoint"}));
    assert.equal(c.payload.exception,"notSupported"); assert.equal([200,404].includes(b.status),true);
  });
});
