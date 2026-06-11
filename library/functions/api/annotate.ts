import postgres from "postgres";

interface Env { SUPABASE_DB_URL: string }

// TEMPORARY probe — proves postgres.js connects to the Supabase pooler from the
// Workers runtime. Replaced by the real POST handler in Task 4.
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = context.env.SUPABASE_DB_URL;
  if (!url) return Response.json({ error: "not configured" }, { status: 500 });
  const sql = postgres(url, { ssl: "require", prepare: false, fetch_types: false });
  try {
    const rows = await sql`select 1 as probe`;
    return Response.json({ ok: true, probe: rows[0].probe });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  } finally {
    context.waitUntil(sql.end());
  }
};
