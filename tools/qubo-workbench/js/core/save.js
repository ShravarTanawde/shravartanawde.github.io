/* ============================================================================
   save.js — save codes.  model -> JSON -> deflate -> base64url -> a string the
   user can copy, and the exact inverse.

   Save codes are the ONLY persistence and the ONLY "export" of state. They are
   tool-produced and tool-consumed; there is deliberately no human-authored
   interchange format. Nothing here touches the network.

   Wire format:

       QW<envelope><flag><payload>
        |      |       |      '-- base64url, no padding
        |      |       '-- 'z' = deflate-raw, 'p' = plain (no CompressionStream)
        |      '-- envelope version, digits. Currently 1.
        '-- literal marker

   Two versions live here and they are not the same thing:
     * the ENVELOPE version, above, describes this wrapper;
     * model.schemaVersion (in qubo.js) describes the JSON inside it.
   Either can move without the other. Both are checked on decode, and a code
   from a newer build is refused with a readable message rather than a crash.
   ============================================================================ */

import { SCHEMA_VERSION, computeMeta } from './qubo.js?v=1';

const MARKER = 'QW';
const ENVELOPE_VERSION = 1;

/* CompressionStream is native in current Chrome/Safari/Firefox and in Node 18+.
   Where it is missing we still produce a working (longer) code rather than
   failing — the flag character tells the decoder which it got. */
const HAS_COMPRESSION =
  typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

/* ------------------------------------------------------------ base64url ---- */

function bytesToBase64url(bytes) {
  let bin = '';
  /* chunked: String.fromCharCode.apply blows the argument limit on big arrays */
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ------------------------------------------------------------ compression -- */

async function pipeThrough(bytes, stream) {
  const writer = stream.writable.getWriter();
  /* On damaged input the stream errors and BOTH sides reject. We report the
     read side (it carries the useful failure) and must still settle the write
     side, or the runtime sees an unhandled rejection and, in Node, exits. */
  const written = writer.write(bytes).then(() => writer.close()).catch(() => {});
  const chunks = [];
  let total = 0;
  const reader = stream.readable.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  await written;
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

const deflate = (bytes) => pipeThrough(bytes, new CompressionStream('deflate-raw'));
const inflate = (bytes) => pipeThrough(bytes, new DecompressionStream('deflate-raw'));

/* ------------------------------------------------------------------ encode -- */

/**
 * A model with a non-finite number in it would come back as `null` through JSON
 * and silently corrupt the instance. Refuse instead.
 */
function assertFinite(model) {
  const walk = (v, path) => {
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) throw new TypeError('Cannot save: ' + path + ' is ' + v + '.');
      return;
    }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, path + '[' + i + ']')); return; }
    if (v && typeof v === 'object') { for (const k of Object.keys(v)) walk(v[k], path + '.' + k); }
  };
  walk(model, 'model');
}

/**
 * @param {object} model the canonical model from qubo.js
 * @returns {Promise<string>} the save code
 */
export async function encode(model) {
  assertFinite(model);
  const json = JSON.stringify(model);
  const bytes = new TextEncoder().encode(json);
  if (HAS_COMPRESSION) {
    const packed = await deflate(bytes);
    return MARKER + ENVELOPE_VERSION + 'z' + bytesToBase64url(packed);
  }
  return MARKER + ENVELOPE_VERSION + 'p' + bytesToBase64url(bytes);
}

/* ------------------------------------------------------------------ decode -- */

export class SaveCodeError extends Error {
  constructor(message, kind) {
    super(message);
    this.name = 'SaveCodeError';
    this.kind = kind;                 // 'format' | 'version' | 'corrupt' | 'schema'
  }
}

/**
 * @param {string} code a save code, whitespace anywhere tolerated
 * @returns {Promise<object>} the model
 * @throws {SaveCodeError}
 */
export async function decode(code) {
  const s = String(code || '').replace(/\s+/g, '');
  if (!s) throw new SaveCodeError('No save code was entered.', 'format');

  const m = /^QW(\d+)([zp])(.*)$/.exec(s);
  if (!m) {
    throw new SaveCodeError('That does not look like a workbench save code — they start with "QW1".', 'format');
  }
  const envelope = Number(m[1]);
  const flag = m[2];
  const payload = m[3];

  if (envelope > ENVELOPE_VERSION) {
    throw new SaveCodeError(
      'This code was made by a newer version of the workbench (envelope v' + envelope +
      ', this build reads v' + ENVELOPE_VERSION + ').', 'version');
  }
  if (flag === 'z' && !HAS_COMPRESSION) {
    throw new SaveCodeError('This browser cannot read compressed save codes (no DecompressionStream).', 'format');
  }

  let json;
  try {
    let bytes = base64urlToBytes(payload);
    if (flag === 'z') bytes = await inflate(bytes);
    json = new TextDecoder().decode(bytes);
  } catch (e) {
    throw new SaveCodeError('That save code is damaged — it may have been cut short when copied.', 'corrupt');
  }

  let model;
  try { model = JSON.parse(json); } catch (e) {
    throw new SaveCodeError('That save code is damaged — the contents did not parse.', 'corrupt');
  }

  return normalize(model);
}

/* --------------------------------------------------------------- normalize -- */

/**
 * Structural gate between "some JSON arrived" and "this is a model". Cheap
 * checks only; verify.js does the mathematics.
 */
export function normalize(model) {
  if (!model || typeof model !== 'object') {
    throw new SaveCodeError('That save code did not contain a model.', 'corrupt');
  }
  if (typeof model.schemaVersion !== 'number') {
    throw new SaveCodeError('That save code has no schema version.', 'schema');
  }
  if (model.schemaVersion > SCHEMA_VERSION) {
    throw new SaveCodeError(
      'This instance was saved by a newer version of the workbench (schema v' +
      model.schemaVersion + ', this build reads v' + SCHEMA_VERSION + ').', 'version');
  }
  if (model.convention !== 'QUBO') {
    throw new SaveCodeError('Unexpected convention "' + model.convention + '" — models are stored as QUBO.', 'schema');
  }
  if (!Array.isArray(model.variables) || !Array.isArray(model.Q)) {
    throw new SaveCodeError('That save code is missing its variables or its Q matrix.', 'corrupt');
  }
  if (model.Q.length !== model.variables.length) {
    throw new SaveCodeError('That save code is inconsistent: ' + model.variables.length +
      ' variables but a ' + model.Q.length + '-row matrix.', 'corrupt');
  }
  if (typeof model.offset !== 'number') {
    throw new SaveCodeError('That save code is missing its constant offset.', 'corrupt');
  }
  /* meta is derived, never trusted from the wire */
  model.meta = computeMeta(model.variables);
  return model;
}

/** Whether this build can produce compressed (short) codes. For the UI note. */
export const compressionAvailable = HAS_COMPRESSION;
