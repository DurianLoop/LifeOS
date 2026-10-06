'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {startBottleReminders}=require('./bottle-reminders.cjs');
test('native arrivals deduplicate across polls, retry failed ack, and route clicks',async()=>{
  const notices=[],acks=[],opens=[];let ackFailure=true;
  class Note extends EventEmitter{static isSupported(){return true}constructor(options){super();this.options=options;notices.push(this)}show(){this.emit('show')}close(){this.emit('close')}}
  const service=startBottleReminders({base:'http://fixture',Notification:Note,onOpen:id=>opens.push(id),interval:1e9,
    requestJSON:async(base,path,body)=>{if(!body)return {native_pending:['bottle_fixture']};acks.push(body);if(ackFailure){ackFailure=false;throw new Error('temporary')}return {ok:true}}});
  await new Promise(setImmediate);await service.poll();assert.equal(notices.length,1);assert.equal(acks.length,2);notices[0].emit('click');assert.deepEqual(opens,['bottle_fixture']);service.stop();
});
test('a failed native notification is retried and never acknowledged',async()=>{
  let attempts=0,acks=0;
  class Note extends EventEmitter{static isSupported(){return true}show(){attempts++;this.emit('failed')}close(){}}
  const service=startBottleReminders({base:'http://fixture',Notification:Note,onOpen(){},interval:1e9,
    requestJSON:async(base,path,body)=>{if(body){acks++;return {ok:true}}return {native_pending:['bottle_fixture']}}});
  await new Promise(setImmediate);await service.poll();assert.equal(attempts,2);assert.equal(acks,0);service.stop();
});
