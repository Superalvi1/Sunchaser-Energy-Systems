import fs from "fs";

async function main() {
  console.log("Requesting template preview PDF...");
  try {
    const res = await fetch("http://localhost:3000/api/export/pdf/template-preview/tmpl-1");
    if (!res.ok) {
      console.log("Failed to fetch. Status:", res.status);
      const text = await res.text();
      console.log("Response text:", text);
      return;
    }
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync("scratch/test-preview.pdf", buffer);
    console.log("✅ PDF saved to scratch/test-preview.pdf. Size:", buffer.length, "bytes.");
  } catch (e: any) {
    console.error("Error fetching PDF:", e.message);
  }
}

main();
