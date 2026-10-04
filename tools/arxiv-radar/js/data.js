/* ============================================================================
   data.js: the only module that fetches anything.

   Rules:
     * It fetches the tool's own two data files and nothing else. The page
       makes no other network request: no arXiv, no API, no analytics.
     * radar.json loads first and the page renders from it alone. details.json
       (paper lists) is fetched the first time a topic panel opens, and only
       once.
     * A file whose schema this page does not know is refused rather than
       half-rendered: a page and data file out of step would show wrong numbers
       with no sign anything is off.
   ============================================================================ */

export const SCHEMA = 1;

export class SchemaError extends Error {}

async function getJSON(name) {
  const res = await fetch('data/' + name, { cache: 'no-cache' });
  if (!res.ok) throw new Error(name + ': HTTP ' + res.status);
  const doc = await res.json();
  if (!doc || doc.schema !== SCHEMA) throw new SchemaError(name + ': schema ' + (doc && doc.schema));
  return doc;
}

/* Turns the compact topic rows into objects once, so nothing downstream has to
   know the column order. */
export function unpackRows(rows, cols) {
  return rows.map((row) => {
    const o = {};
    cols.forEach((c, k) => { o[c] = row[k]; });
    return o;
  });
}

export async function loadRadar() {
  const radar = await getJSON('radar.json');
  for (const byFilter of Object.values(radar.views)) {
    for (const v of Object.values(byFilter)) {
      v.topics = unpackRows(v.topics, radar.topic_cols);
      v.broad = unpackRows(v.broad, radar.topic_cols);
    }
  }
  return radar;
}

let detailsPromise = null;
export function loadDetails() {
  if (!detailsPromise) {
    detailsPromise = getJSON('details.json').catch((e) => { detailsPromise = null; throw e; });
  }
  return detailsPromise;
}
