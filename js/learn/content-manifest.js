/* ============================================================
   content-manifest.js — which nodes have a fragment in learn/nodes/.

   The graph has to know, before it draws anything, which nodes are written and
   which are stubs. Probing with fetch() would mean up to 76 requests and a
   console full of 404s on every load, so the list is explicit.

   Add an id here in the same commit that adds learn/nodes/<id>.html. The
   validator checks that every id here is a real node; it cannot check that the
   file exists, because there is no build step.
   ============================================================ */

export const AUTHORED = new Set([
  'no-cloning',
  'interference-mach-zehnder'
]);

export function isAuthored(id) {
  return AUTHORED.has(id);
}
