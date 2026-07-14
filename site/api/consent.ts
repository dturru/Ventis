import type { VercelRequest, VercelResponse } from "@vercel/node";
import pg from "pg";   // pg is CommonJS; default-import + destructure works under ESM ("type":"module")
import { validateConsentPayload } from "./_validate.js";  // .js extension required for ESM relative-import resolution

const { Client } = pg;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });

  const v = validateConsentPayload(req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });

  const url = process.env.SUPABASE_DB_URL;
  if (!url) return res.status(500).json({ error: "not configured" });

  // Supabase requires SSL; from a serverless function without it the connect hangs
  // into a platform timeout (FUNCTION_INVOCATION_FAILED). rejectUnauthorized:false
  // matches the standard pg + Supabase pooler setup. Fail fast so errors are catchable.
  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  });
  try {
    await client.connect();
    // Flood guard: cap rapid repeats per deployment code. This is anti-spam only — the
    // real anti-forgery control is reconcile_consent's gate (a public-form opt-in only
    // verifies a run that was started through the authenticated launcher).
    const recent = await client.query<{ n: number }>(
      "select count(*)::int as n from consent_submissions " +
      "where deployment_code = $1 and agreed_at > now() - interval '60 seconds'",
      [v.value.code],
    );
    if ((recent.rows[0]?.n ?? 0) >= 5) {
      return res.status(429).json({ error: "too many submissions, please slow down" });
    }
    await client.query(
      "insert into consent_submissions " +
      "(deployment_code, condition, consent_method, attested_by, terms_version, notes) " +
      "values ($1,$2,$3,$4,$5,$6)",
      [v.value.code, v.value.condition, v.value.method,
       v.value.attested_by, v.value.terms_version, v.value.notes],
    );
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("consent insert failed:", e);   // surfaces in Vercel function logs
    return res.status(500).json({ error: "could not record consent" });
  } finally {
    await client.end().catch(() => {});
  }
}
