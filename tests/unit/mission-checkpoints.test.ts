import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import {
  missionContextFingerprint,
  restoreMissionStageCheckpoint,
  restoreMissionStageCheckpointFromEvents,
  saveMissionStageCheckpoint,
} from "../../lib/mission-checkpoints";

const analysisSchema=z.object({audience:z.string(),opportunities:z.array(z.string())});

test("mission stage checkpoints restore only for the exact context and valid shape",()=>{
  const context={clientId:"synthetic",knowledgeRevision:4,request:"Prepare a campaign"};
  const fingerprint=missionContextFingerprint(context);
  const saved=saveMissionStageCheckpoint({audience:"adults",opportunities:["Carousel"]},fingerprint);

  assert.deepEqual(restoreMissionStageCheckpoint(saved,fingerprint,analysisSchema),{
    audience:"adults",opportunities:["Carousel"],
  });
  assert.equal(restoreMissionStageCheckpoint(saved,missionContextFingerprint({...context,knowledgeRevision:5}),analysisSchema),null);
  assert.equal(restoreMissionStageCheckpoint(saveMissionStageCheckpoint({audience:7},fingerprint),fingerprint,analysisSchema),null);
  assert.equal(restoreMissionStageCheckpoint({audience:"adults",opportunities:["Carousel"]},fingerprint,analysisSchema),null);

  const events=[
    {agent:"Strategist",recipient:"Copywriter",summary:"Strategia e KPI consegnati",result:saved},
    {agent:"Analyst",recipient:"Strategist",summary:"Evidenze e opportunità consegnate",result:saved},
  ];
  assert.deepEqual(restoreMissionStageCheckpointFromEvents(events,
    {agent:"Analyst",recipient:"Strategist",summary:"Evidenze e opportunità consegnate"},fingerprint,analysisSchema),
  {audience:"adults",opportunities:["Carousel"]});
  assert.equal(restoreMissionStageCheckpointFromEvents(events,
    {agent:"Copywriter",recipient:"Brand Guard",summary:"Bozze editoriali"},fingerprint,analysisSchema),null);
});
