import {eoaVerification} from './payments/eoa-verification.js';
import {nativeLogin} from './auth/native-login.js';
import {protectedRooms} from './payments/protected-rooms.js';
import {CompactRelay} from './sponsorship/compact-relay.js';
import {configureCompactRelay} from './sponsorship/configure.js';
import {MerchantBudgets} from './sponsorship/manage.js';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { pathToFileURL } from "node:url";
import type { Database, Row } from "./db/database.js";
import { postgres } from "./db/database.js";
import { migrate } from "./db/migrate.js";
import {
  ApiError,
  hash,
  requireThat,
  token,
  text,
  integer,
  address,
  hex32,
} from "./lib.js";
import {
  Sessions,
  googleVerifier,
  type IdentityVerifier,
} from "./auth/session.js";
import { WalletBindings } from "./auth/wallet-binding.js";
import { Rooms } from "./rooms/service.js";
import { roomAttendance } from "./rooms/attendance.js";
import { Inventory } from "./bookings/inventory.js";
import { Templates } from "./templates/routes.js";
import { Support } from "./support/service.js";
import { syncAccount } from "./sync/routes.js";
import { validatePreferences } from "./notifications/policy.js";
import { deliverInApp, scheduleReminders } from "./notifications/worker.js";
import {
  extractInvoice,
  validateInvoice,
  type OcrAdapter,
} from "./invoice/extract.js";
import { runIndexer } from "./indexer/worker.js";
import { evmReader } from "./indexer/evm-reader.js";
import { EmbedSessions } from "./embed/sessions.js";
import { httpOcr } from "./invoice/http-adapter.js";
import {
  httpEmail,
  deliverEmail,
  scheduleEmail,
  type EmailTransport,
} from "./notifications/email.js";
import {
  verifyRefundTransfer,
  evmRefundReader,
  type FinalizedTransfer,
} from "./support/verify-transfer.js";
import { deliverWebhooks, validateDestinations } from "./embed/webhooks.js";
import { deletePrivateProfile } from "./auth/privacy.js";
import {
  validateExecutionConfig,
  forAccount,
  type ExecutionConfig,
} from "./payments/config.js";
import { persistAttempt } from "./payments/attempts.js";
import {reconcileAttempt,evmAttemptReader,type AttemptReader} from './payments/reconcile.js';
import {roomCredits,evmCreditReader,type CreditReader} from './payments/credits.js';
import {nativeReader,nativeCreditReader} from './indexer/native-reader.js';
import {AtomicAccounts,type AtomicAccountVerifier} from './auth/atomic-account.js';
import {nativeAtomicAccountVerifier} from './auth/atomic-native-reader.js';
export type AppConfig = {
  compactRelay?:CompactRelay;
  protectedRelay?:CompactRelay;
  origin: string;
  chainId: number;
  googleClientId?: string;
  verifyIdentity?: IdentityVerifier;
  secureCookies?: boolean;
  localDevelopment?: boolean;
  ocr?: OcrAdapter;
  email?: EmailTransport;
  privyAppId?: string;
  privyAppSecret?: string;
  embedAllowedOrigins?: string[];
  refundReader?: (txHash: `0x${string}`) => Promise<FinalizedTransfer>;
  paymentExecution?: ExecutionConfig;
  attemptReader?:AttemptReader;
  creditReader?:CreditReader;
  atomicAccountVerifier?:AtomicAccountVerifier;
  protectedDeployment?: {
    version: "protected-v2";
    chainId: number;
    rpcUrl: string;
    address: string;
    deploymentBlock: string;
  };
};
function cookies(req: IncomingMessage) {
  return Object.fromEntries(
    (req.headers.cookie ?? "")
      .split(";")
      .map((x) => x.trim().split("="))
      .filter((x) => x.length === 2),
  );
}
async function body(req: IncomingMessage, max = 256 * 1024) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    requireThat(size <= max, "request_too_large", undefined, 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export function createApp(db: Database, config: AppConfig) {
  const sessions = new Sessions(
    db,
    config.verifyIdentity ??
      (config.googleClientId
        ? googleVerifier(config.googleClientId)
        : undefined),
  );
  const wallets = new WalletBindings(db, config.origin),
    rooms = new Rooms(db, config.chainId),
    inventory = new Inventory(db),
    templates = new Templates(db, rooms),
    support = new Support(db);
  const embeds = new EmbedSessions(db, config.embedAllowedOrigins ?? []);
  const atomicAccounts=new AtomicAccounts(db,config.chainId,config.atomicAccountVerifier);
  const eoaCheck=config.protectedDeployment&&config.chainId===420420777
    ?eoaVerification(db,config.protectedDeployment,'wss://test-node-v3.portaldot.dev'):null;
  const cookie = (name: string, value: string, max = 28800) =>
    `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${max}${config.secureCookies !== false ? "; Secure" : ""}`;
  const limits = new Map<string, { count: number; until: number }>();
  const server = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    const send = (value: unknown, status = 200) => {
      res.statusCode = status;
      res.end(JSON.stringify(value));
    };
    try {
      const url = new URL(req.url ?? "/", config.origin),
        path = url.pathname,
        method = req.method ?? "GET",
        cs = cookies(req),
        user = await sessions.get(cs.pactpay_session);
      if (path === "/health") {
        await db.query("SELECT 1");
        return send({ ok: true, database: "reachable" });
      }
      if (path === "/api/config" && method === "GET") {
        const wallet = user ? await wallets.get(user.id, config.chainId) : null;
        return send({
          googleClientId: config.googleClientId ?? null,
          googleAvailable: !!config.googleClientId,
          privyAppId: config.privyAppId ?? null,
          privyAvailable: !!(config.privyAppId && config.privyAppSecret),
          walletAvailable: !!(config.privyAppId && config.privyAppSecret),
          chainId: config.chainId,
          localDevelopment: !!config.localDevelopment,
          ocr: config.ocr
            ? { recipient: config.ocr.recipient, cloud: config.ocr.cloud }
            : null,
          ocrRecipient: config.ocr?.recipient ?? null,
          protectedDeployment: config.protectedDeployment ?? null,
          paymentExecution: forAccount(
            config.paymentExecution,
            wallet?.account_address,
          )??(wallet?.mode==='embedded-eoa'&&eoaCheck?await eoaCheck.execution(wallet.account_address):null),
          capabilities: {
            google: !!config.googleClientId,
            embeddedWallet: !!(config.privyAppId && config.privyAppSecret),
            sponsoring: !!config.compactRelay?.available,
            protectedSponsoring: !!config.protectedRelay?.available,
            protectedSponsorshipPrepared: true,
            batching: !!config.compactRelay?.available,
            protectedContract: !!config.protectedDeployment,
            ocr: !!config.ocr,
            email: !!config.email,
          },
        });
      }
      if (path === "/api/session" && method === "GET") {
        let csrfToken: string;
        if (user) csrfToken = await sessions.rotateCsrf(cs.pactpay_session);
        else {
          const anonymous = token();
          res.setHeader("Set-Cookie", cookie("pactpay_anon", anonymous, 900));
          csrfToken = hash(`login:${anonymous}`);
        }
        const b = user ? await wallets.get(user.id, config.chainId) : null;
        return send({
          user: user ? { id: user.id, displayName: user.display_name } : null,
          binding: b
            ? {
                walletId: b.wallet_id,
                ownerAddress: b.owner_address,
                accountAddress: b.account_address,
                chainId: Number(b.chain_id),
                mode: b.mode,
              }
            : null,
          csrfToken,
          atomicAccount: user ? await atomicAccounts.get(user.id) : null,
        });
      }
      if (!["GET", "HEAD"].includes(method)) {
        requireThat(
          req.headers.origin === config.origin,
          "origin_rejected",
          undefined,
          403,
        );
        const supplied = req.headers["x-csrf-token"];
        requireThat(
          typeof supplied === "string" &&
            (user
              ? hash(supplied) === user.csrf_hash
              : !!cs.pactpay_anon &&
                supplied === hash(`login:${cs.pactpay_anon}`)),
          "csrf_rejected",
          undefined,
          403,
        );
        const key = req.socket.remoteAddress ?? "unknown",
          now = Date.now();
        let rate = limits.get(key);
        if (!rate || rate.until <= now) {
          rate = { count: 0, until: now + 60000 };
          limits.set(key, rate);
        }
        requireThat(++rate.count <= 90, "rate_limited", undefined, 429);
        if (limits.size > 10000)
          for (const [k, v] of limits) if (v.until < now) limits.delete(k);
      }
      let p: Row = {};
      if (
        !["GET", "HEAD"].includes(method) &&
        path !== "/api/invoice/extract"
      ) {
        const data = await body(req);
        try {
          p = data.length ? JSON.parse(data.toString("utf8")) : {};
        } catch {
          throw new ApiError(400, "invalid_json", "Invalid JSON");
        }
        requireThat(
          p && typeof p === "object" && !Array.isArray(p),
          "invalid_body",
        );
      }
      if(path==="/api/auth/native/challenge"&&method==="POST")
        return send(await nativeLogin(db,config.origin,config.chainId).challenge(p.address,cs.pactpay_session??cs.pactpay_anon));
      if(path==="/api/auth/native"&&method==="POST"){
        const result=await nativeLogin(db,config.origin,config.chainId).verify(p.challengeId,p.signature,cs.pactpay_session??cs.pactpay_anon);
        if(cs.pactpay_session)await sessions.logout(cs.pactpay_session);
        res.setHeader("Set-Cookie",[cookie("pactpay_session",result.sessionToken),cookie("pactpay_anon","",0)]);
        return send({user:{id:result.user.id,displayName:result.user.display_name},csrfToken:result.csrfToken});
      }
      if (path === "/api/auth/google" && method === "POST") {
        const result = await sessions.login(text(p.idToken, 20000));
        if (cs.pactpay_session) await sessions.logout(cs.pactpay_session);
        res.setHeader("Set-Cookie", [
          cookie("pactpay_session", result.sessionToken),
          cookie("pactpay_anon", "", 0),
        ]);
        return send({
          user: { id: result.user.id, displayName: result.user.display_name },
          csrfToken: result.csrfToken,
        });
      }
      if (path === "/api/auth/privy" && method === "POST") {
        requireThat(
          config.privyAppId && config.privyAppSecret,
          "privy_not_configured",
          undefined,
          503,
        );
        const { privyLogin } = await import("./auth/privy.js");
        const result = await privyLogin(
          db,
          config.privyAppId,
          config.privyAppSecret,
          config.chainId,
          text(p.accessToken, 20000),
        );
        res.setHeader("Set-Cookie", [
          cookie("pactpay_session", result.sessionToken),
          cookie("pactpay_anon", "", 0),
        ]);
        return send({
          user: { id: result.user.id, displayName: result.user.display_name },
          binding: result.binding,
          csrfToken: result.csrfToken,
        });
      }
      const embed = path.match(/^\/api\/embed\/sessions\/([^/]+)$/);
      if (embed && method === "GET") {
        const session = await embeds.get(embed[1]);
        res.setHeader(
          "Content-Security-Policy",
          `frame-ancestors 'self' ${session.merchantOrigin}`,
        );
        return send({ session });
      }
      // Public receipts never reveal private room data.
      const receipt = path.match(
        /^\/api\/receipts\/(\d+)\/(0x[\da-fA-F]{40})\/(0x[\da-fA-F]{64})$/,
      );
      if (receipt && method === "GET") {
        const deployment = config.protectedDeployment;
        const snapshot = deployment && Number(receipt[1]) === deployment.chainId &&
          receipt[2].toLowerCase() === deployment.address.toLowerCase()
          ? await protectedRooms(db, deployment).publicReceipt(hex32(receipt[3]) as `0x${string}`)
          : undefined;
        const indexed = (
          await db.query(
            "SELECT chain_id,tx_hash,log_index,block_number,block_hash,escrow,quote_id,kind,payload,source,coverage,contract_version FROM chain_events WHERE chain_id=$1 AND escrow=$2 AND quote_id=$3 ORDER BY block_number::numeric,log_index",
            [receipt[1], receipt[2].toLowerCase(), receipt[3].toLowerCase()],
          )
        ).rows;
        const recorded = snapshot ? (await db.query(
          `SELECT b.chain_id,b.escrow,b.quote_id,e.tx_hash,e.log_index,e.block_number,e.block_hash,
             e.event_name AS kind,e.event_args AS payload,'room-finalized' AS source,'recorded-only' AS coverage
           FROM protected_room_bindings b JOIN protected_room_events e ON e.room_id=b.room_id
           WHERE b.chain_id=$1 AND lower(b.escrow)=$2 AND lower(b.quote_id)=$3 AND e.event_name IN ('Created','Funded','Captured','Disputed','Settled')`,
          [receipt[1], receipt[2].toLowerCase(), receipt[3].toLowerCase()],
        )).rows : [];
        const unique = new Map([...recorded, ...indexed].map(event => [event.tx_hash + ':' + event.log_index, event]));
        const events = [...unique.values()].filter(event => !snapshot ||
          (event.kind !== 'Claimed' && BigInt(event.block_number) <= BigInt(snapshot.blockNumber)),
        ).sort((a, b) => BigInt(a.block_number) === BigInt(b.block_number)
          ? Number(a.log_index) - Number(b.log_index)
          : BigInt(a.block_number) < BigInt(b.block_number) ? -1 : 1);
        return send({
          events,
          coverage: events.length ? "indexed-finalized" : "unknown",
          snapshot,
        });
      }
      requireThat(user, "authentication_required", undefined, 401);
      const uid = user.id;
      if(path==='/api/account/eoa-verification'){
        requireThat(eoaCheck,'execution_verification_unavailable',undefined,503);
        const wallet=await wallets.get(uid,config.chainId);
        requireThat(wallet,'wallet_binding_required',undefined,409);
        if(method==='GET')return send(await eoaCheck.status(wallet));
        if(method==='POST')return send(await eoaCheck.verify(wallet,p));
      }
      if(path==='/api/account/atomic'){
        if(method==='GET')return send({account:await atomicAccounts.get(uid),relayAvailable:!!(config.compactRelay?.available||config.protectedRelay?.available)});
        if(method==='POST')return send({account:await atomicAccounts.register(uid,p.accountAddress),relayAvailable:!!(config.compactRelay?.available||config.protectedRelay?.available)});
      }
      if(path==='/api/account/atomic/activate'&&method==='POST')return send({account:await atomicAccounts.activate(uid,p.enabled),relayAvailable:!!(config.compactRelay?.available||config.protectedRelay?.available)});
      if(path==='/api/sponsorship/budgets'){
        const budgets=new MerchantBudgets(db,!!(config.compactRelay?.available||config.protectedRelay?.available));
        if(method==='GET')return send({budgets:await budgets.list(uid)});
        if(method==='POST')return send({budget:await budgets.save(uid,null,p)},201);
      }
      const budgetRoute=path.match(/^\/api\/sponsorship\/budgets\/([^/]+)$/);
      if(budgetRoute&&method==='PATCH')return send({budget:await new MerchantBudgets(db,!!(config.compactRelay?.available||config.protectedRelay?.available)).save(uid,budgetRoute[1],p)});

      const sponsoredRoute=path.match(/^\/api\/rooms\/([^/]+)\/(sponsorship|sponsored-intents)(?:\/([^/]+))?(?:\/(submit|cancel))?$/);
      if(sponsoredRoute){const [,roomId,kind,intentId,operation]=sponsoredRoute;const sponsoredRoom=await rooms.get(uid,roomId);const relay=sponsoredRoom.settlementVersion==='protected-v2'?config.protectedRelay:config.compactRelay;
        if(kind==='sponsorship'&&method==='GET')return send(relay?await relay.status(uid,roomId):{available:false,prepared:true,reason:'Fee coverage is prepared and waiting to be enabled.'});
        requireThat(relay,'relay_unavailable',undefined,503);
        if(!intentId&&method==='POST')return send({intent:await relay.create(uid,roomId,p)},201);
        if(intentId&&method==='GET')return send({intent:await relay.get(uid,roomId,intentId)});
        if(intentId&&method==='POST'&&operation==='submit')return send({intent:await relay.submit(uid,roomId,intentId,p.signature)});
        if(intentId&&method==='POST'&&operation==='cancel')return send({intent:await relay.cancel(uid,roomId,intentId)});
      }
      if (path === "/api/embed/sessions" && method === "POST")
        return send({ session: await embeds.create(uid, p) }, 201);
      if (path === "/api/auth/logout" && method === "POST") {
        await sessions.logout(cs.pactpay_session);
        res.setHeader("Set-Cookie", cookie("pactpay_session", "", 0));
        return send({ loggedOut: true });
      }
      if (path === "/api/account/delete-private-profile" && method === "POST") {
        const result = await deletePrivateProfile(db, uid, p.confirmation);
        res.setHeader("Set-Cookie", cookie("pactpay_session", "", 0));
        return send(result);
      }
      if (path === "/api/wallet/challenge" && method === "POST")
        return send(await wallets.challenge(uid, p.chainId, p.address));
      if (path === "/api/wallet/bind" && method === "POST")
        return send({
          binding: await wallets.bind(
            uid,
            text(p.challengeId, 100),
            p.signature,
          ),
        });
      if (path === "/api/rooms") {
        if (method === "GET") return send({ rooms: await rooms.list(uid) });
        if (method === "POST")
          return send({ room: await rooms.create(uid, p) }, 201);
      }
      const room = path.match(/^\/api\/rooms\/([^/]+)(?:\/(.*))?$/);
      if (room) {
        const rid = room[1],
          action = room[2];
        if (!action && method === "GET")
          return send({ room: await rooms.get(uid, rid) });
        if (!action && method === "PATCH")
          return send({ room: await rooms.edit(uid, rid, p) });
        if (action === "attendance") {
          const attendance = roomAttendance(db);
          if (method === "GET") return send({ confirmations: await attendance.read(uid, rid) });
          if (method === "POST") return send({ confirmations: await attendance.confirm(uid, rid) });
        }
        if (action === "protected-booking") {
          requireThat(config.protectedDeployment, "protected_deployment_unavailable", undefined, 503);
          const protectedService=protectedRooms(db,config.protectedDeployment);
          if(method==="GET")return send(await protectedService.read(uid,rid));
          if(method==="POST")return send({room:await protectedService.bind(uid,rid,p)});
        }
        if(action==="protected-events"&&method==="POST"){
          requireThat(config.protectedDeployment,"protected_deployment_unavailable",undefined,503);
          return send(await protectedRooms(db,config.protectedDeployment).record(uid,rid,p));
        }
        if (action === "invitations" && method === "POST")
          return send({ invitation: await rooms.invite(uid, rid, p) }, 201);
        const revoke = action?.match(/^invitations\/([^/]+)\/revoke$/);
        if (revoke && method === "POST")
          return send(await rooms.revoke(uid, rid, revoke[1]));
        if (action === "accept" && method === "POST")
          return send({ room: await rooms.accept(uid, rid, p.revision) });
        if (action === "lock" && method === "POST")
          return send({ room: await rooms.lock(uid, rid, p.revision) });
        if (action === "publish-intents" && method === "POST")
          return send({ intent: await rooms.publish(uid, rid, p) });
        const submitted = action?.match(
          /^publish-intents\/([^/]+)\/submitted$/,
        );
        if (submitted && method === "POST")
          return send({
            intent: await rooms.submitted(uid, rid, submitted[1], p.txHash),
          });
        if (action === "hold" && method === "POST")
          return send({ hold: await inventory.reserve(uid, rid, p) });
        if (action === "payment-attempts" && method === "POST")
          return send({ attempt: await persistAttempt(db, uid, rid, p) });
        const attemptReconcile=action?.match(/^payment-attempts\/([^/]+)\/reconcile$/);
        if(attemptReconcile&&method==='POST'){requireThat(config.attemptReader,'attempt_reader_not_configured',undefined,503);return send(await reconcileAttempt(db,uid,rid,attemptReconcile[1],config.attemptReader,p.txHash));}
        if(action==='credits'&&method==='GET'){requireThat(config.creditReader,'credit_reader_not_configured',undefined,503);return send(await roomCredits(db,uid,rid,config.creditReader));}
        if (action === "support" && method === "GET")
          return send({ requests: await support.list(uid, rid) });
        if (action === "support" && method === "POST")
          return send({ request: await support.create(uid, rid, p) }, 201);
      }
      const invitationLookup=path.match(/^\/api\/invitations\/([^/]+)$/);
      if(invitationLookup&&method==="GET")return send(await rooms.invitationDetails(uid,invitationLookup[1]));
      const invite = path.match(/^\/api\/invitations\/([^/]+)\/join$/);
      if (invite && method === "POST")
        return send({ room: await rooms.join(uid, invite[1], p) });
      if (path === "/api/slots") {
        if (method === "GET") return send({ slots: await inventory.list(uid) });
        if (method === "POST")
          return send({ slot: await inventory.create(uid, p) }, 201);
      }
      if (path === "/api/templates") {
        if (method === "GET")
          return send({ templates: await templates.list(uid) });
        if (method === "POST")
          return send({ template: await templates.create(uid, p) }, 201);
      }
      const duplicate = path.match(/^\/api\/templates\/([^/]+)\/duplicate$/);
      if (duplicate && method === "POST")
        return send(
          { room: await templates.duplicate(uid, duplicate[1], p) },
          201,
        );
      if (path === "/api/sync" && method === "GET")
        return send(await syncAccount(db, rooms, uid,url.searchParams.get('after')??undefined));
      if (path === "/api/notifications/preferences") {
        if (method === "PATCH") {
          validatePreferences(p, !!config.email);
          requireThat(
            !p.email || user.notification_email,
            "verified_notification_email_required",
            undefined,
            409,
          );
          await db.query(
            "INSERT INTO notification_preferences(user_id,in_app,email,timezone,quiet_start,quiet_end) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id) DO UPDATE SET in_app=EXCLUDED.in_app,email=EXCLUDED.email,timezone=EXCLUDED.timezone,quiet_start=EXCLUDED.quiet_start,quiet_end=EXCLUDED.quiet_end",
            [uid, p.inApp, p.email, p.timezone, p.quietStart, p.quietEnd],
          );
        }
        const pref = (
          await db.query(
            "SELECT * FROM notification_preferences WHERE user_id=$1",
            [uid],
          )
        ).rows[0];
        return send({
          preferences: pref
            ? {
                inApp: pref.in_app,
                email: pref.email,
                timezone: pref.timezone,
                quietStart: pref.quiet_start,
                quietEnd: pref.quiet_end,
              }
            : {
                inApp: true,
                email: false,
                timezone: "UTC",
                quietStart: 22,
                quietEnd: 8,
              },
        });
      }
      if (path === "/api/notifications" && method === "GET")
        return send({
          notifications: (
            await db.query(
              "SELECT id,room_id,kind,payload,delivered_at FROM outbox WHERE user_id=$1 AND status='delivered' ORDER BY delivered_at DESC LIMIT 100",
              [uid],
            )
          ).rows,
        });
      if (path === "/api/invoice/validate" && method === "POST")
        return send(validateInvoice(p));
      if (path === "/api/invoice/extract" && method === "POST")
        return send(
          await extractInvoice(
            await body(req, 10 * 1024 * 1024),
            req.headers["content-type"] ?? "",
            config.ocr,
            req.headers["x-ocr-consent-recipient"] as string | undefined,
          ),
        );
      const supp = path.match(
        /^\/api\/support\/([^/]+)\/(decision|transfer|reconcile)$/,
      );
      if (supp && method === "POST") {
        if (supp[2] === "reconcile") {
          const r = (
            await db.query("SELECT room_id FROM support_requests WHERE id=$1", [
              supp[1],
            ])
          ).rows[0];
          requireThat(r, "request_not_found", undefined, 404);
          await rooms.get(uid, r.room_id);
          requireThat(
            config.refundReader,
            "refund_reader_not_configured",
            undefined,
            503,
          );
          return send(
            await verifyRefundTransfer(db, supp[1], config.refundReader),
          );
        }
        return send({
          request:
            supp[2] === "decision"
              ? await support.decision(uid, supp[1], p.decision)
              : await support.transfer(uid, supp[1], p.txHash),
        });
      }
      throw new ApiError(404, "not_found", "Route not found");
    } catch (e) {
      if (e instanceof ApiError)
        return send({ error: { code: e.code, message: e.message } }, e.status);
      const code = (e as { code?: string }).code;
      if (code === "23505")
        return send(
          {
            error: {
              code: "conflict",
              message: "A unique record already exists",
            },
          },
          409,
        );
      send(
        {
          error: {
            code: "server_error",
            message: "Request failed; retry a safe read or contact support",
          },
        },
        500,
      );
    }
  });
  return { server, sessions, rooms, wallets, inventory, templates, support };
}
export async function start(db: Database, localDevelopment = false) {
  await migrate(db);
  const config: AppConfig = {
    origin: process.env.APP_ORIGIN ?? "http://127.0.0.1:5173",
    chainId: Number(process.env.CHAIN_ID ?? 420420777),
    googleClientId: process.env.GOOGLE_CLIENT_ID,
    privyAppId: process.env.PRIVY_APP_ID,
    privyAppSecret: process.env.PRIVY_APP_SECRET,
    secureCookies: !localDevelopment,
    localDevelopment,
    embedAllowedOrigins: (process.env.EMBED_ALLOWED_ORIGINS ?? "")
      .split(",")
      .filter(Boolean),
  };
  const relaySetup=await configureCompactRelay(db);if(relaySetup)config.compactRelay=relaySetup.relay;
  if (process.env.OCR_ENDPOINT && process.env.OCR_RECIPIENT) {
    requireThat(
      new URL(process.env.OCR_ENDPOINT).origin ===
        process.env.OCR_ALLOWED_ORIGIN,
      "ocr_endpoint_not_allowed",
    );
    config.ocr = httpOcr(
      process.env.OCR_ENDPOINT,
      process.env.OCR_RECIPIENT,
      process.env.OCR_BEARER_TOKEN,
    );
  }
  if (
    process.env.EMAIL_ENDPOINT &&
    process.env.EMAIL_ALLOWED_ORIGIN &&
    process.env.EMAIL_BEARER_TOKEN
  )
    config.email = httpEmail(
      process.env.EMAIL_ENDPOINT,
      process.env.EMAIL_ALLOWED_ORIGIN,
      process.env.EMAIL_BEARER_TOKEN,
    );
  if (process.env.REFUND_RPC && process.env.REFUND_TOKEN)
    config.refundReader = evmRefundReader(
      process.env.REFUND_RPC,
      config.chainId,
      address(process.env.REFUND_TOKEN) as `0x${string}`,
    );
  if (process.env.PAYMENT_EXECUTION_CONFIG)
    config.paymentExecution = validateExecutionConfig(
      JSON.parse(process.env.PAYMENT_EXECUTION_CONFIG),
      config.chainId,
      localDevelopment,
    );
  const readRpc=process.env.PAYMENT_READ_RPC??config.paymentExecution?.rpcUrl??process.env.INDEXER_RPC;
  if(readRpc){config.attemptReader=evmAttemptReader(readRpc,config.chainId);config.creditReader=evmCreditReader(readRpc,config.chainId);}
  if(process.env.NATIVE_RPC){const nativeCredits=nativeCreditReader(process.env.NATIVE_RPC,config.chainId);const evmCredits=config.creditReader;config.creditReader=evmCredits?async(...args)=>{try{return await evmCredits(...args);}catch{return nativeCredits(...args);}}:nativeCredits;}
  if(config.chainId===420420777)config.atomicAccountVerifier=nativeAtomicAccountVerifier(process.env.NATIVE_RPC??'wss://test-node-v3.portaldot.dev',config.chainId);
  if (
    process.env.PROTECTED_RPC &&
    process.env.PROTECTED_ADDRESS &&
    process.env.PROTECTED_DEPLOYMENT_BLOCK
  ) {
    requireThat(
      /^\d+$/.test(process.env.PROTECTED_DEPLOYMENT_BLOCK),
      "invalid_protected_deployment_block",
    );
    const rpc = new URL(process.env.PROTECTED_RPC);
    requireThat(
      !rpc.username && !rpc.password && !rpc.search,
      "public_rpc_must_not_contain_credentials",
    );
    requireThat(
      rpc.protocol === "https:" ||
        (localDevelopment && rpc.hostname === "127.0.0.1"),
      "invalid_protected_rpc",
    );
    config.protectedDeployment = {
      version: "protected-v2",
      chainId: config.chainId,
      rpcUrl: rpc.href,
      address: address(process.env.PROTECTED_ADDRESS),
      deploymentBlock: process.env.PROTECTED_DEPLOYMENT_BLOCK,
    };
  }
  requireThat(
    localDevelopment || config.origin.startsWith("https://"),
    "production_https_required",
  );
  const protectedRelaySetup=config.protectedDeployment?await configureCompactRelay(db,config.protectedDeployment):null;
  if(protectedRelaySetup)config.protectedRelay=protectedRelaySetup.relay;
  const app = createApp(db, config);
  const timers: ReturnType<typeof setInterval>[] = [];
  let busy = false;
  const webhookDestinations = process.env.MERCHANT_WEBHOOK_DESTINATIONS
    ? validateDestinations(
        JSON.parse(process.env.MERCHANT_WEBHOOK_DESTINATIONS),
      )
    : [];
  timers.push(
    setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        await config.compactRelay?.tick();
        await config.protectedRelay?.tick();
        await scheduleReminders(db);
        if (config.email) {
          await scheduleEmail(db);
          await deliverEmail(db, config.email, config.origin);
        }
        await deliverInApp(db);
        await deliverWebhooks(db, webhookDestinations);
      } catch {
        console.error("Notification worker failed; retrying next interval");
      } finally {
        busy = false;
      }
    }, 30000),
  );
  if (
    (process.env.INDEXER_RPC||process.env.NATIVE_RPC) &&
    process.env.INDEXER_ESCROW &&
    process.env.INDEXER_START
  ) {
    const source=process.env.INDEXER_SOURCE??'evm';requireThat(source==='native'||source==='evm','invalid_indexer_source');
    requireThat(source==='native'?process.env.NATIVE_RPC:process.env.INDEXER_RPC,'indexer_source_rpc_required');
    const reader = source==='native'?nativeReader(process.env.NATIVE_RPC!,config.chainId,address(process.env.INDEXER_ESCROW) as `0x${string}`):evmReader(process.env.INDEXER_RPC!,config.chainId,address(process.env.INDEXER_ESCROW) as `0x${string}`);
    let indexing = false;
    timers.push(
      setInterval(async () => {
        if (indexing) return;
        indexing = true;
        try {
          await runIndexer(
            db,
            "pactpay-v1",
            config.chainId,
            BigInt(process.env.INDEXER_START!),
            reader,
          );
        } catch {
          console.error("Indexer unavailable; cursor preserved");
        } finally {
          indexing = false;
        }
      }, 15000),
    );
  }
  if (config.protectedDeployment) {
    const deployment = config.protectedDeployment,
      reader = evmReader(
        deployment.rpcUrl,
        deployment.chainId,
        deployment.address as `0x${string}`,
        "V2",
      );
    let indexing = false;
    timers.push(
      setInterval(async () => {
        if (indexing) return;
        indexing = true;
        try {
          await runIndexer(
            db,
            "pactpay-v2",
            deployment.chainId,
            BigInt(deployment.deploymentBlock),
            reader,
          );
        } catch {
          console.error("V2 indexer unavailable; cursor preserved");
        } finally {
          indexing = false;
        }
      }, 15000),
    );
  }
  const host=process.env.HOST??'127.0.0.1';requireThat(['127.0.0.1','0.0.0.0'].includes(host),'invalid_bind_host');
  app.server.listen(Number(process.env.PORT ?? 8787), host, () =>
    console.log(
      `PactPay API listening on ${host}:${process.env.PORT ?? 8787}; ${localDevelopment ? "local embedded PostgreSQL" : "PostgreSQL"}`,
    ),
  );
  const stop = () => {
    for (const timer of timers) clearInterval(timer);
    app.server.close(() => {void relaySetup?.close();void protectedRelaySetup?.close();void db.close();});
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  return app;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  requireThat(process.env.DATABASE_URL, "database_url_required");
  await start(postgres(process.env.DATABASE_URL));
}
