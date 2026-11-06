const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
function prepareRelease(dist,out){
 const outputRoot=path.resolve(out);if(outputRoot===path.parse(outputRoot).root||outputRoot===path.resolve(dist))throw Error('Unsafe release output directory');
 fs.mkdirSync(outputRoot,{recursive:true});for(const entry of fs.readdirSync(outputRoot)){if(entry==='.vercel')continue;const target=path.resolve(outputRoot,entry);if(path.dirname(target)!==outputRoot)throw Error('Release cleanup escaped its output directory');fs.rmSync(target,{recursive:true,force:true});}
 fs.mkdirSync(out,{recursive:true});for(const name of ['index.html','assets','art','deploy-artifacts']){const source=path.join(dist,name);if(fs.existsSync(source))fs.cpSync(source,path.join(out,name),{recursive:true});}
 const config={version:2,framework:null,headers:[{source:'/(.*)',headers:[{key:'X-Content-Type-Options',value:'nosniff'},{key:'Referrer-Policy',value:'strict-origin-when-cross-origin'}]}],rewrites:[{source:'/deployment.json',destination:'/unavailable-local-fixture.json'},{source:'/sample-quote.json',destination:'/unavailable-local-fixture.json'},{source:'/((?!api(?:/|$)|assets/|art/|deploy-artifacts/).*)',destination:'/index.html'}]};
 const origins=(process.env.EMBED_ALLOWED_ORIGINS||'').split(',').filter(v=>{try{return new URL(v).origin===v&&v.startsWith('https://');}catch{return false;}});
 config.headers.push({source:'/embed',headers:[{key:'Content-Security-Policy',value:`frame-ancestors 'self' ${origins.join(' ')}`} ]});
 if(process.env.PACTPAY_API_ORIGIN){const api=new URL(process.env.PACTPAY_API_ORIGIN);if(api.protocol!=='https:'||api.username||api.password||api.search||api.hash||api.pathname!=='/')throw Error('PACTPAY_API_ORIGIN must be an exact public HTTPS API origin');config.rewrites.unshift({source:'/api/:path*',destination:`${api.origin}/api/:path*`});}
 fs.writeFileSync(path.join(out,'vercel.json'),JSON.stringify(config,null,2));
 fs.writeFileSync(path.join(out,'unavailable-local-fixture.json'),JSON.stringify({unavailable:true,reason:'Local demonstration data is excluded from this release.'}));
 fs.writeFileSync(path.join(out,'release.json'),JSON.stringify({builtAt:new Date().toISOString(),mode:'native-wallet-testnet',contractDeployed:false,localFixturesIncluded:false},null,2));
}
module.exports={prepareRelease};
if(require.main===module){execFileSync(process.platform==='win32'?'cmd.exe':'npm',process.platform==='win32'?['/c','npm run build']:['run','build'],{stdio:'inherit',env:{...process.env,VITE_NATIVE_DEFAULT:'true'}});const out=path.resolve('release','site');prepareRelease(path.resolve('dist'),out);console.log('Static native release prepared: '+out);}
