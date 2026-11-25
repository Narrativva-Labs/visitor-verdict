import { isMemoryNonceStore } from './replay.js';
import { createHash, verify } from 'node:crypto';
import type { Dictionary, InnerList } from 'structured-headers';
import { signatureBase, type AgentClaims, type Context, type SignatureFields } from './fields.js';
import { Failure, failure } from './errors.js';
import { publicKeys, activeKey, withKidAliases } from './keys.js';
import { checkSignaturePolicy } from './policy.js';
import type { AgentCache } from './cache.js';
import type { AgentVerdict, Registry, NonceStore, SignatureResult } from './types.js';

interface Evaluation {
  result: SignatureResult;
  verified?: AgentVerdict['verified'];
}
interface SignatureContext {
  context: Context;
  headers: Map<string, string[]>;
  agent: AgentClaims;
  registry: Registry;
  cache: AgentCache;
  now: number;
  signal: AbortSignal;
  nonceStore?: NonceStore;
  nonceTimeoutMs: number;
  fields: Omit<SignatureFields, 'label'>;
  maxLifetimeSeconds: number;
  cacheOnly: boolean;
  secure?: boolean;
  directoryLoads?: Map<string, { fetched: boolean }>;
}
function checkActive(signal: AbortSignal) {
  if (signal.aborted) throw new Failure('deadline_exceeded', true);
}
export async function insertNonce(
  store: NonceStore,
  key: string,
  ttl: number,
  timeoutMs: number,
  scope: string,
  expiresAt: number,
  now: number,
): Promise<boolean> {
  if (isMemoryNonceStore(store)) return store.insertIfAbsent(key, ttl, { scope, expiresAt, now });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      store.insertIfAbsent(key, ttl),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Failure('nonce_store_timeout', true)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
/** Each candidate returns its own result. Unrecognized exceptions never prove an invalid signature. */
export async function evaluateSignature(
  label: string,
  inputs: Dictionary,
  sigs: Dictionary,
  env: SignatureContext,
): Promise<Evaluation> {
  try {
    checkActive(env.signal);
    const member = inputs.get(label);
    const sig = sigs.get(label);
    if (member && Array.isArray(member[0]) && member[1].get('tag') !== 'web-bot-auth')
      return { result: { label, result: 'none', reason: 'ignored_non_wba' } };
    if (member && env.secure === false) throw new Failure('insufficient_context', true);
    if (
      !member ||
      !sig ||
      !Array.isArray(member[0]) ||
      !(sig[0] instanceof ArrayBuffer) ||
      sig[1].size
    )
      throw new Failure('malformed_signature');
    const inner = member as InnerList;
    if (env.fields.inputs.invalidTimestamps.has(label))
      throw new Failure('invalid_timestamp_type', true);
    if (env.fields.inputs.lossyLabels.has(label)) throw new Failure('unsupported_component', true);
    const keyid = checkSignaturePolicy(inner, env.now, env.maxLifetimeSeconds);
    const covered = inner[0].filter(([name]) => name === 'signature-agent');
    let identity = env.agent.legacy;
    let attribution: SignatureResult['attribution'];
    if (env.agent.members) {
      const keys = new Set(
        covered.flatMap(([, params]) => {
          const key = params.get('key');
          return params.size === 1 && typeof key === 'string' ? [key] : [];
        }),
      );
      if (!keys.size) throw new Failure('signature_agent_not_covered');
      if (!keys.has(label) && keys.size > 1) throw new Failure('ambiguous_signature_agent', true);
      const memberKey = keys.has(label) ? label : keys.values().next().value!;
      identity = env.agent.identities.get(memberKey);
      attribution = memberKey === label ? 'label' : 'relabeled';
    } else if (identity && !covered.some(([, params]) => !params.size))
      throw new Failure('signature_agent_not_covered');
    const operator = env.registry.find((o) => o.signatureAgent === identity);
    if (!identity || !operator?.directoryUrl) throw new Failure('untrusted_signature_agent', true);
    if (sig[0].byteLength !== 64) throw new Failure('invalid_signature_length');
    const bytes = Buffer.from(sig[0]);
    const base = signatureBase(env.context, env.headers, inner, { ...env.fields, label });
    const trace = env.directoryLoads?.get(operator.directoryUrl) ?? { fetched: false };
    env.directoryLoads?.set(operator.directoryUrl, trace);
    let keys = withKidAliases(
      await env.cache.load(
        operator.directoryUrl,
        'directory',
        env.now,
        publicKeys,
        env.cacheOnly ? 'cached' : 'request',
        trace,
      ),
      operator.allowKidAlias === true,
    );
    checkActive(env.signal);
    if (keys.has(keyid) && !activeKey(keys.get(keyid)!, env.now)) {
      // Missing evidence: refresh asynchronously even while HTTP cache is fresh.
      void env.cache
        .load(operator.directoryUrl, 'directory', env.now, publicKeys, 'cached-forced')
        .catch(() => {});
      throw new Failure('unknown_keyid', true);
    }
    if (!keys.has(keyid))
      keys = withKidAliases(
        await env.cache.load(
          operator.directoryUrl,
          'directory',
          env.now,
          publicKeys,
          env.cacheOnly ? 'cached-forced' : 'forced',
          trace,
        ),
        operator.allowKidAlias === true,
      );
    checkActive(env.signal);
    let key = keys.get(keyid);
    if (!key || !activeKey(key, env.now)) throw new Failure('unknown_keyid', true);
    if (!verify(null, Buffer.from(base, 'ascii'), key.key, bytes)) {
      if (keyid !== key.thumbprint && !trace.fetched) {
        if (env.cacheOnly) {
          // Same-kid rotation: bounded single-flight refresh without waiting on the hit.
          void env.cache
            .load(operator.directoryUrl, 'directory', env.now, publicKeys, 'cached-forced')
            .catch(() => {});
          throw new Failure('insufficient_context', true);
        }
        keys = withKidAliases(
          await env.cache.load(
            operator.directoryUrl,
            'directory',
            env.now,
            publicKeys,
            'mismatch',
            trace,
          ),
          operator.allowKidAlias === true,
        );
        checkActive(env.signal);
        key = keys.get(keyid);
        if (!key || !activeKey(key, env.now)) throw new Failure('unknown_keyid', true);
        if (!verify(null, Buffer.from(base, 'ascii'), key.key, bytes))
          throw new Failure('crypto_mismatch');
      } else throw new Failure('crypto_mismatch');
    }
    if (env.nonceStore) {
      if (env.cacheOnly && !isMemoryNonceStore(env.nonceStore))
        throw new Failure('insufficient_context', true);
      const nonce = inner[1].get('nonce');
      const expires = inner[1].get('expires') as number;
      if (typeof nonce !== 'string' || !nonce) throw new Failure('missing_nonce');
      const inserted = await insertNonce(
        env.nonceStore,
        createHash('sha256')
          .update(JSON.stringify([identity, key.thumbprint, nonce]))
          .digest('hex'),
        Math.max(1, Math.ceil(expires + 30 - env.now)),
        env.nonceTimeoutMs,
        operator.operator,
        expires + 30,
        env.now,
      );
      checkActive(env.signal);
      if (!inserted) throw new Failure('replay');
    }
    return {
      result: { label, result: 'signature_valid', reason: 'verified', attribution },
      verified: {
        operator: operator.operator,
        method: 'signature',
        expiresAt: inner[1].get('expires') as number,
        signatureAgent: identity,
        keyid,
        keyidForm: keyid === key.thumbprint ? 'thumbprint' : 'kid',
        attribution,
      },
    };
  } catch (error) {
    const f = failure(error);
    return {
      result: {
        label,
        result: f.reason === 'crypto_mismatch' ? 'signature_invalid' : 'none',
        reason: f.reason,
      },
    };
  }
}
