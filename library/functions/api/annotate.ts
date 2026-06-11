import postgres from "postgres";
import { validateAnnotationPayload, resolveUpdatedBy } from "./_annotate";

interface Env { SUPABASE_DB_URL: string }

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const v = validateAnnotationPayload(await context.request.json().catch(() => null));
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 });

  const url = context.env.SUPABASE_DB_URL;
  if (!url) return Response.json({ error: "not configured" }, { status: 500 });

  // Cloudflare Access has already authenticated the founder at the edge; this
  // header is the verified identity (never an occupant).
  const updatedBy = resolveUpdatedBy(
    context.request.headers.get("Cf-Access-Authenticated-User-Email"),
  );

  const sql = postgres(url, { ssl: "require", prepare: false, fetch_types: false });
  try {
    // Same upsert as site/scripts/annotate.py::_upsert_pg.
    await sql`
      insert into annotations (run_key, note, quality_flag, tags, updated_by, updated_at)
      values (${v.value.run_key}, ${v.value.note}, ${v.value.quality_flag},
              ${v.value.tags}, ${updatedBy}, now())
      on conflict (run_key) do update set
        note = excluded.note,
        quality_flag = excluded.quality_flag,
        tags = excluded.tags,
        updated_by = excluded.updated_by,
        updated_at = now()
    `;
    return Response.json({ ok: true });
  } catch (e) {
    console.error("annotation upsert failed:", e);
    return Response.json({ error: "could not save annotation" }, { status: 500 });
  } finally {
    context.waitUntil(sql.end());
  }
};
