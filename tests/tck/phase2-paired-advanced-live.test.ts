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

live("phase2.changeToken compares conditional updates", { timeout: 90_000 }, async () => {
  requireDestructiveTckConfig(config); const root = config.runRootId ?? config.parentRootId; assert.ok(root);
  const cmis = createCmisClient(config); const box = await createBoxRestClient(config); const comparison = createSideBySideComparison(); const runId = buildRunId();
  let cmisId: string | undefined; let boxId: string | undefined;
  await recordTimedResult({ runId: `${runId}-phase2-change-token-comparison`, reportDir: config.reportDir, phase: "phase2", testId: "phase2.changeToken", openCmisTests: ["ChangeTokenTest"], coverageMode: "equivalent", fixtureRootId: root, createdObjectCount: 2, deletedObjectCount: 2, cleanupStatus: "pass", details: { comparison } }, async () => {
    try {
      const c = await cmis.createDocument(`folder:${root}`, `${buildFixtureName(runId,"phase2","token-cmis")}.txt`, "token"); cmisId = propertyValue(c,"cmis:objectId"); assert.ok(cmisId);
      const b = await box.uploadFile(root, `${buildFixtureName(runId,"phase2","token-box")}.txt`, "token"); boxId = b.id;
      const cp = await cmis.getProperties(cmisId, "cmis:changeToken"); const token = cp["cmis:changeToken"]?.value; assert.equal(typeof token,"string");
      const bm = await box.getFileFields(boxId,["etag"]); assert.equal(typeof bm.etag,"string");
      await measureOperation(comparison,"conditional-rename","cmis",()=>cmis.updateNameStatus(cmisId!,`${buildFixtureName(runId,"phase2","token-updated-cmis")}.txt`,String(token)),v=>({httpStatus:v.status}));
      await measureOperation(comparison,"conditional-rename","box-rest",()=>box.updateFileNameWithEtag(boxId!,`${buildFixtureName(runId,"phase2","token-updated-box")}.txt`,String(bm.etag)),v=>({httpStatus:v.status}));
      const cs = await measureOperation(comparison,"stale-token-rename","cmis",()=>cmis.updateNameStatus(cmisId!,"stale-cmis.txt",String(token)),v=>({httpStatus:v.status,exception:v.payload.exception}));
      const bs = await measureOperation(comparison,"stale-token-rename","box-rest",()=>box.updateFileNameWithEtag(boxId!,"stale-box.txt",String(bm.etag)),v=>({httpStatus:v.status,code:v.payload.code}));
      assert.equal(cs.status,409); assert.equal(bs.status,412);
    } finally { if(cmisId) await cmis.deleteObject(cmisId); if(boxId) await box.deleteFile(boxId); }
  });
});

live("phase2.contentRanges compares ranged downloads", { timeout: 90_000 }, async () => {
  requireDestructiveTckConfig(config); const root=config.runRootId??config.parentRootId; assert.ok(root);
  const cmis=createCmisClient(config); const box=await createBoxRestClient(config); const comparison=createSideBySideComparison(); const runId=buildRunId(); let cmisId:string|undefined; let boxId:string|undefined;
  await recordTimedResult({runId:`${runId}-phase2-content-range-comparison`,reportDir:config.reportDir,phase:"phase2",testId:"phase2.contentRanges",openCmisTests:["ContentRangesTest"],coverageMode:"equivalent",fixtureRootId:root,createdObjectCount:2,deletedObjectCount:2,cleanupStatus:"pass",details:{comparison}},async()=>{
    try { const content="0123456789"; const c=await cmis.createDocument(`folder:${root}`,`${buildFixtureName(runId,"phase2","range-cmis")}.txt`,content); cmisId=propertyValue(c,"cmis:objectId"); assert.ok(cmisId); const b=await box.uploadFile(root,`${buildFixtureName(runId,"phase2","range-box")}.txt`,content); boxId=b.id;
      const cr=await measureOperation(comparison,"range-bytes-2-5","cmis",()=>cmis.getContentRange(cmisId!,"bytes=2-5"),v=>v);
      const br=await measureOperation(comparison,"range-bytes-2-5","box-rest",()=>box.getFileContentRange(boxId!,"bytes=2-5"),v=>v);
      assert.equal(cr.status,206); assert.equal(br.status,206); assert.equal(cr.text,"2345"); assert.equal(br.text,"2345");
    } finally { if(cmisId) await cmis.deleteObject(cmisId); if(boxId) await box.deleteFile(boxId); }
  });
});

live("phase2.copy compares file copy", { timeout: 90_000 }, async () => {
  requireDestructiveTckConfig(config); const root=config.runRootId??config.parentRootId; assert.ok(root);
  const cmis=createCmisClient(config); const box=await createBoxRestClient(config); const comparison=createSideBySideComparison(); const runId=buildRunId(); let cf:string|undefined; let bf:string|undefined;
  await recordTimedResult({runId:`${runId}-phase2-copy-comparison`,reportDir:config.reportDir,phase:"phase2",testId:"phase2.copy",openCmisTests:["CopyTest"],coverageMode:"equivalent",fixtureRootId:root,createdObjectCount:6,deletedObjectCount:6,cleanupStatus:"pass",details:{comparison}},async()=>{
    try { const cfolder=await cmis.createFolder(`folder:${root}`,buildFixtureName(runId,"phase2","copy-target-cmis")); cf=propertyValue(cfolder,"cmis:objectId"); assert.ok(cf); const bfolder=await box.createFolder(root,buildFixtureName(runId,"phase2","copy-target-box")); bf=bfolder.id;
      const cs=await cmis.createDocument(`folder:${root}`,`${buildFixtureName(runId,"phase2","copy-source-cmis")}.txt`,"copy"); const csid=propertyValue<string>(cs,"cmis:objectId"); assert.ok(csid); const bs=await box.uploadFile(root,`${buildFixtureName(runId,"phase2","copy-source-box")}.txt`,"copy");
      const cc=await measureOperation(comparison,"copy-file","cmis",()=>cmis.copyDocument(csid,cf!,"copy-cmis.txt"),v=>({objectId:propertyValue(v,"cmis:objectId")}));
      const bc=await measureOperation(comparison,"copy-file","box-rest",()=>box.copyFile(bs.id,bf!,"copy-box.txt"),v=>({objectId:v.id})); assert.ok(propertyValue(cc,"cmis:objectId")); assert.ok(bc.id);
      await cmis.deleteObject(csid); await box.deleteFile(bs.id);
    } finally { if(cf) await cmis.deleteTree(cf); if(bf) await box.deleteFolder(bf,true); }
  });
});

live("phase2.move compares parent moves", { timeout: 90_000 }, async () => {
  requireDestructiveTckConfig(config); const root=config.runRootId??config.parentRootId; assert.ok(root);
  const cmis=createCmisClient(config); const box=await createBoxRestClient(config); const comparison=createSideBySideComparison(); const runId=buildRunId(); let cf:string|undefined; let bf:string|undefined; let cid:string|undefined; let bid:string|undefined;
  await recordTimedResult({runId:`${runId}-phase2-move-comparison`,reportDir:config.reportDir,phase:"phase2",testId:"phase2.move",openCmisTests:["MoveTest"],coverageMode:"equivalent",fixtureRootId:root,createdObjectCount:4,deletedObjectCount:4,cleanupStatus:"pass",details:{comparison}},async()=>{
    try { const cfolder=await cmis.createFolder(`folder:${root}`,buildFixtureName(runId,"phase2","move-target-cmis")); cf=propertyValue(cfolder,"cmis:objectId"); assert.ok(cf); const bfolder=await box.createFolder(root,buildFixtureName(runId,"phase2","move-target-box")); bf=bfolder.id;
      const cd=await cmis.createDocument(`folder:${root}`,`${buildFixtureName(runId,"phase2","move-cmis")}.txt`,"move"); cid=propertyValue(cd,"cmis:objectId"); assert.ok(cid); const bd=await box.uploadFile(root,`${buildFixtureName(runId,"phase2","move-box")}.txt`,"move"); bid=bd.id;
      await measureOperation(comparison,"move-file","cmis",()=>cmis.moveObject(cid!,`folder:${root}`,cf!),v=>({objectId:propertyValue(v,"cmis:objectId")}));
      await measureOperation(comparison,"move-file","box-rest",()=>box.moveFile(bid!,bf!),v=>({objectId:v.id,parentId:bf})); cid=undefined; bid=undefined;
    } finally { if(cid) await cmis.deleteObject(cid); if(bid) await box.deleteFile(bid); if(cf) await cmis.deleteTree(cf); if(bf) await box.deleteFolder(bf,true); }
  });
});
