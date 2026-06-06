import JSZip from "jszip";
import type { Run } from "./catalog";

export const DATA_DICTIONARY = `Ventis Data Library — dataset export
=====================================

Each run is one continuous logging session in one room/condition.

catalog.json        index of all runs (one record each; = the runs table)
csv/<run_id>.csv    full raw readings for that run
charts/<slug>.png   the standard 3-panel SOP chart

CSV columns
-----------
timestamp      local time, "YYYY-MM-DD HH:MM:SS"
co2_ppm        CO2 (ppm). Sensor: Sensirion SCD4x, ~+/-50 ppm
temp_c         indoor temperature (deg C)
humidity_pct   relative humidity (%)
fan_duty       device fan duty 0-100 (%)
window_state   "open"/"closed"/"" if logged
condition      building_condition_occupancy label (anonymized; never names/room numbers)

References
----------
ASHRAE indoor CO2 guidance: ~1000 ppm. ~1400 ppm = cognitive impairment threshold.
Methodology / SOP: see the About page in the catalog.
`;

/** Build a zip of catalog.json + all per-run CSVs + a data dictionary, and download it. */
export async function downloadDataset(runs: Run[]): Promise<void> {
  const zip = new JSZip();
  zip.file("README.txt", DATA_DICTIONARY);

  const cat = await fetch("/data/catalog.json").then((r) => r.text());
  zip.file("catalog.json", cat);

  const csvDir = zip.folder("csv")!;
  await Promise.all(
    runs.map(async (r) => {
      try {
        const text = await fetch(`/data/csv/${r.csv}`).then((res) => res.text());
        csvDir.file(r.csv, text);
      } catch {
        /* skip a missing csv rather than fail the whole export */
      }
    })
  );

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ventis-dataset-${new Date().toISOString().slice(0, 10)}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
