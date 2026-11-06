import {test} from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import {ContractFactory,JsonRpcProvider} from 'ethers';
import {readFileSync} from 'node:fs';
import {embedded} from '../db/database.js';
import {migrate} from '../db/migrate.js';
import {upsertIdentity} from '../auth/session.js';
import {Rooms} from '../rooms/service.js';
import {protectedRooms} from '../payments/protected-rooms.js';
import {roomAttendance} from '../rooms/attendance.js';
import {createApp} from '../app.js';
import {id} from '../lib.js';
const artifact=(name:string)=>JSON.parse(readFileSync(new URL('../../artifacts/contracts/'+name+'.sol/'+name+'.json',import.meta.url),'utf8'));
test('protected room invitation, immutable V2 publication, cancelled refund and finalized receipt stay linked',async()=>{
 const chain=ganache.server({logging:{quiet:true},chain:{chainId:31337}});
 await chain.listen(0);
 const location=chain.address();
 assert(location&&typeof location!=='string');
 const rpc='http://127.0.0.1:'+location.port;
 const provider=new JsonRpcProvider(rpc);
 const db=embedded();
 try{
  await migrate(db);
  const merchant=await provider.getSigner(0),buyer=await provider.getSigner(1);
  const accounts=[await merchant.getAddress(),await buyer.getAddress()].map(a=>a.toLowerCase());
  const users:{id:string}[]=[];
  for(let i=0;i<accounts.length;i++){
   const user=await upsertIdentity(db,{issuer:'test',subject:accounts[i],displayName:'User '+i});
   users.push({id:user.id});
   await db.query("INSERT INTO wallet_bindings(id,user_id,provider,wallet_id,owner_address,account_address,chain_id,mode) VALUES($1,$2,'test',$3,$3,$3,31337,'embedded-eoa')",[id(),user.id,accounts[i]]);
  }
  const tokenArtifact=artifact('DemoUSD'),protectedArtifact=artifact('PactPayProtected');
  const token=await new ContractFactory(tokenArtifact.abi,tokenArtifact.bytecode,merchant).deploy();
  await token.waitForDeployment();
  const contract=await new ContractFactory(protectedArtifact.abi,protectedArtifact.bytecode,merchant).deploy(await token.getAddress());
  await contract.waitForDeployment();
  const rooms=new Rooms(db,31337),now=Math.floor(Date.now()/1000);
  let room=await rooms.create(users[0].id,{settlementVersion:'protected-v2',complaintSeconds:60,resolutionSeconds:60,title:'Refund workshop',publicTerms:'Cancellation refunds paid shares.',total:'10000',fundingDeadline:new Date((now+3600)*1000).toISOString(),serviceAt:new Date((now+7200)*1000).toISOString()});
  const invitation=await rooms.invite(users[0].id,room.id,{expiresAt:room.fundingDeadline,share:'10000'});
  assert.equal(await rooms.invitationRoom(users[1].id,invitation.token),null);
  const {preview}=await rooms.invitationDetails(users[1].id,invitation.token);
  assert.equal(preview?.title,'Refund workshop');
  assert.equal(preview?.share,'10000');
  await assert.rejects(()=>rooms.join(users[1].id,invitation.token,{nickname:'Buyer',share:'5000'}),/invitation_share_mismatch/);
  room=await rooms.join(users[1].id,invitation.token,{nickname:'Buyer',share:'10000'});
  await rooms.accept(users[1].id,room.id,room.revision);
  room=await rooms.lock(users[0].id,room.id,room.revision);
  assert.equal(room.settlementVersion,'protected-v2');
  assert.equal((await rooms.invitationRoom(users[1].id,invitation.token))!.id,room.id);
  await assert.rejects(()=>rooms.publish(users[0].id,room.id,{revision:room.revision}),/use_protected_checkout/);
  const create=await contract.getFunction('create')([accounts[1]],[10000n],now+3600,now+7200,60,60,room.termsHash);
  const created=await create.wait();
  const event=created.logs.map((log:any)=>{try{return contract.interface.parseLog(log);}catch{return null;}}).find((e:any)=>e?.name==='Created');
  const quoteId=event!.args.bookingId;
  const service=protectedRooms(db,{version:'protected-v2',chainId:31337,rpcUrl:rpc,address:await contract.getAddress(),deploymentBlock:'0'});
  // A correct quote without its Created transaction cannot be attached.
  await assert.rejects(()=>service.bind(users[0].id,room.id,{revision:room.revision,quoteId,blockNumber:String(created.blockNumber),txHash:'0x'+'0'.repeat(64)}),/protected_created_event_required/);
  room=await service.bind(users[0].id,room.id,{revision:room.revision,quoteId,blockNumber:String(created.blockNumber),txHash:create.hash});
  assert.equal(room.protectedBooking?.quoteId,quoteId);
  assert.equal(room.status,'published');
  const attendance=roomAttendance(db);
  await assert.rejects(()=>attendance.confirm(users[1].id,room.id),/attendance_not_open/);
  await assert.rejects(()=>attendance.confirm(users[0].id,room.id),/attendance_member_required/);
  await assert.rejects(()=>attendance.read('outsider',room.id),/forbidden/);
  const afterService=roomAttendance(db,()=>new Date((now+7201)*1000));
  const confirmed=await afterService.confirm(users[1].id,room.id);
  assert.equal(confirmed.length,1);
  assert.deepEqual(await afterService.confirm(users[1].id,room.id),confirmed);
  assert.deepEqual(await afterService.read(users[0].id,room.id),confirmed);
  const publicReceipt=await service.publicReceipt(quoteId);
  assert.deepEqual(publicReceipt.positions,[{account:accounts[1],share:'10000',paid:'0',disputed:false,settled:false,contractCredit:'0'}]);
  assert.ok(!JSON.stringify(publicReceipt).includes(users[1].id));
  // Retrying the verified bind is idempotent.
  await service.bind(users[0].id,room.id,{revision:room.revision,quoteId,blockNumber:String(created.blockNumber),txHash:create.hash});
  await(await token.getFunction('mint')(accounts[1],10000n)).wait();
  await(await token.connect(buyer).getFunction('approve')(await contract.getAddress(),10000n)).wait();
  const funded=await contract.connect(buyer).getFunction('contribute')(quoteId);
  const fundedReceipt=await funded.wait();
  await service.record(users[1].id,room.id,{txHash:funded.hash,blockNumber:String(fundedReceipt.blockNumber)});
  await(await contract.getFunction('cancel')(quoteId)).wait();
  const settled=await contract.getFunction('settle')(quoteId,accounts[1]);
  const settledReceipt=await settled.wait();
  await service.record(users[0].id,room.id,{txHash:settled.hash,blockNumber:String(settledReceipt.blockNumber)});
  let snapshot=await service.read(users[1].id,room.id);
  assert.equal(snapshot.booking.state,3);
  assert.equal(snapshot.positions[0].credit,'10000');
  const claim=await contract.connect(buyer).getFunction('claim')();
  const claimReceipt=await claim.wait();
  await service.record(users[1].id,room.id,{txHash:claim.hash,blockNumber:String(claimReceipt.blockNumber)});
  snapshot=await service.read(users[1].id,room.id);
  assert.equal(snapshot.positions[0].credit,'0');
  assert.equal(snapshot.positions[0].position[4],true);
  assert.equal(snapshot.events.filter((e:any)=>e.event_name==='Claimed').length,1);
  assert.equal(await token.getFunction('balanceOf')(accounts[1]),10000n);
  const app=createApp(db,{origin:'http://127.0.0.1:5173',chainId:31337,
   protectedDeployment:{version:'protected-v2',chainId:31337,rpcUrl:rpc,address:await contract.getAddress(),deploymentBlock:'0'}});
  await new Promise<void>(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  try{
   const location=app.server.address();
   assert(location&&typeof location!=='string');
   const url='http://127.0.0.1:'+location.port+'/api/receipts/31337/'+(await contract.getAddress()).toLowerCase()+'/'+quoteId;
   const response=await fetch(url);
   assert.equal(response.status,200);
   const receipt=await response.json() as any;
   assert.equal(receipt.snapshot.positions[0].paid,'10000');
   assert.equal(receipt.snapshot.positions[0].settled,true);
   assert.equal(receipt.snapshot.positions[0].contractCredit,'0');
   assert.ok(receipt.events.some((event:any)=>event.kind==='Settled'));
   assert.ok(!receipt.events.some((event:any)=>event.kind==='Claimed'));
   assert.ok(!JSON.stringify(receipt).includes(users[1].id));
   assert.ok(!JSON.stringify(receipt).includes('confirmedAt'));
  }finally{await new Promise<void>(resolve=>app.server.close(()=>resolve()));}
  await assert.rejects(()=>rooms.edit(users[0].id,room.id,{expectedRevision:room.revision,title:'Tampered'}),/room_not_editable/);
  if(process.env.PACTPAY_QA_BROWSER==='1'){
   const {createServer}=await import('node:http');
   const {createApp}=await import('../app.js');
   const {Sessions}=await import('../auth/session.js');
   const {createServer:createVite}=await import('vite');
   const {default:react}=await import('@vitejs/plugin-react');
   const app=createApp(db,{origin:'http://127.0.0.2:5184',chainId:31337,secureCookies:false,localDevelopment:true,protectedDeployment:{version:'protected-v2',chainId:31337,rpcUrl:rpc,address:await contract.getAddress(),deploymentBlock:'0'}});
   const fixtureSessions=new Sessions(db,async value=>({issuer:'test',subject:accounts[value==='merchant'?0:1],displayName:value==='merchant'?'Local QA merchant':'Local QA buyer'}));
   const gateway=createServer(async(req,res)=>{
    if(req.url?.startsWith('/api/qa-fixture-login')){
     const role=new URL(req.url,'http://127.0.0.2:5184').searchParams.get('role')??'buyer';
     const session=await fixtureSessions.login(role);
     res.writeHead(302,{'Set-Cookie':'pactpay_session='+session.sessionToken+'; Path=/; HttpOnly; SameSite=Lax',Location:'/booking'});
     res.end();return;
    }
    app.server.emit('request',req,res);
   });
   await new Promise<void>(resolve=>gateway.listen(0,'127.0.0.1',resolve));
   const endpoint=gateway.address();assert(endpoint&&typeof endpoint!=='string');
   const vite=await createVite({root:new URL('../../',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'),configFile:false,plugins:[react()],server:{host:'127.0.0.2',port:5184,strictPort:true,proxy:{'/api':{target:'http://127.0.0.1:'+endpoint.port,changeOrigin:false}}}});
   await vite.listen();
   console.log('LOCAL EVM FIXTURE ONLY http://127.0.0.2:5184/api/qa-fixture-login?role=buyer');
   try{await new Promise<void>(resolve=>process.once('SIGINT',resolve));}finally{await vite.close();await new Promise<void>(resolve=>gateway.close(()=>resolve()));}
  }

 }finally{provider.destroy();await db.close();await chain.close();}
});
