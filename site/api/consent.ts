import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Client } from "pg";
import { validateConsentPayload } from "./_validate";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });

  const v = validateConsentPayload(req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });

  const url = process.env.SUPABASE_DB_URL;
  if (!url) return res.status(500).json({ error: "not configured" });

  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    await client.query(
      "insert into consent_submissions " +
      "(deployment_code, condition, consent_method, attested_by, terms_version, notes) " +
      "values ($1,$2,$3,$4,$5,$6)",
      [v.value.code, v.value.condition, v.value.method,
       v.value.attested_by, v.value.terms_version, v.value.notes],
    );
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(500).json({ error: "could not record consent" });
  } finally {
    await client.end().catch(() => {});
  }
}
