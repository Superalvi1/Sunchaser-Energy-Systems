import React from "react";
import type { PublicQuoteCalculation, PublicQuoteConfig, PublicQuoteLine } from "../lib/publicQuotationBuilder";

const COLORS = {
  navy: "#0f172a",
  navySoft: "#1e293b",
  gold: "#fbbf24",
  goldSoft: "#fef3c7",
  goldDeep: "#92400e",
  ink: "#172033",
  muted: "#64748b",
  line: "#dbe3ee",
  panel: "#f8fafc",
  green: "#047857",
  greenSoft: "#ecfdf5",
};

const currency = (value: number) => `Rs. ${Math.round(value).toLocaleString("en-PK")}`;

function DetailCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 0, border: `1px solid ${COLORS.line}`, borderRadius: 10, padding: "10px 12px", background: COLORS.panel }}>
      <div style={{ color: COLORS.muted, fontSize: 9, fontWeight: 800, letterSpacing: "0.09em", textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
      <div style={{ color: COLORS.ink, fontSize: 13, fontWeight: 800, overflowWrap: "anywhere" }}>{value}</div>
    </div>
  );
}

function EquipmentCard({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div style={{ borderLeft: `4px solid ${COLORS.gold}`, padding: "7px 10px", background: "#ffffff" }}>
      <div style={{ color: COLORS.muted, fontSize: 9, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ color: COLORS.ink, fontSize: 12, fontWeight: 900, marginTop: 2 }}>{value}</div>
      <div style={{ color: COLORS.muted, fontSize: 9, marginTop: 2 }}>{note}</div>
    </div>
  );
}

function ProfessionalQuoteTable({ lines }: { lines: PublicQuoteLine[] }) {
  const groups = ["Equipment", "Cables & protection", "Structure", "Services"] as const;
  return (
    <div style={{ border: `1px solid ${COLORS.line}`, borderRadius: 12, overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", fontFamily: "Arial, Helvetica, sans-serif" }}>
        <colgroup>
          <col style={{ width: "34%" }} />
          <col style={{ width: "34%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "20%" }} />
        </colgroup>
        <thead>
          <tr style={{ background: COLORS.navy }}>
            {["Item", "Specification", "Qty.", "Amount"].map((label, index) => (
              <th key={label} style={{ color: "#ffffff", fontSize: 10, fontWeight: 800, letterSpacing: "0.04em", padding: "10px 10px", textAlign: index >= 2 ? "right" : "left" }}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            const groupLines = lines.filter((line) => line.category === group);
            if (!groupLines.length) return null;
            return (
              <React.Fragment key={group}>
                <tr>
                  <td colSpan={4} style={{ background: COLORS.goldSoft, color: COLORS.goldDeep, fontSize: 9, fontWeight: 900, letterSpacing: "0.08em", padding: "6px 10px", textTransform: "uppercase", borderTop: `1px solid ${COLORS.line}`, borderBottom: `1px solid ${COLORS.line}` }}>{group}</td>
                </tr>
                {groupLines.map((line, index) => (
                  <tr key={`${group}-${line.description}-${index}`} style={{ background: index % 2 === 0 ? "#ffffff" : "#fbfdff" }}>
                    <td style={{ color: COLORS.ink, fontSize: 10.5, fontWeight: 800, lineHeight: 1.3, padding: "8px 10px", verticalAlign: "top", borderBottom: `1px solid ${COLORS.line}`, overflowWrap: "anywhere" }}>{line.description}</td>
                    <td style={{ color: COLORS.muted, fontSize: 9.5, lineHeight: 1.3, padding: "8px 10px", verticalAlign: "top", borderBottom: `1px solid ${COLORS.line}`, overflowWrap: "anywhere" }}>{line.specification}</td>
                    <td style={{ color: COLORS.ink, fontSize: 10, fontWeight: 700, padding: "8px 10px", textAlign: "right", verticalAlign: "top", borderBottom: `1px solid ${COLORS.line}`, whiteSpace: "nowrap" }}>{line.quantity} {line.unit}</td>
                    <td style={{ color: COLORS.ink, fontSize: 10.5, fontWeight: 900, padding: "8px 10px", textAlign: "right", verticalAlign: "top", borderBottom: `1px solid ${COLORS.line}`, whiteSpace: "nowrap" }}>{line.totalPkr === 0 ? "Included" : currency(line.totalPkr)}</td>
                  </tr>
                ))}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ProfessionalQuotationDocument({
  calculation,
  config,
  quoteNumber,
  clientName,
  clientPhone,
  clientCity,
  batteryQuantity,
}: {
  calculation: PublicQuoteCalculation;
  config: PublicQuoteConfig;
  quoteNumber: string;
  clientName: string;
  clientPhone: string;
  clientCity: string;
  batteryQuantity: number;
}) {
  const date = new Date().toLocaleDateString("en-PK", { day: "2-digit", month: "short", year: "numeric" });
  return (
    <div
      id="generated-quotation"
      style={{
        width: "100%",
        maxWidth: 900,
        margin: "0 auto",
        background: "#ffffff",
        color: COLORS.ink,
        fontFamily: "Arial, Helvetica, sans-serif",
        boxSizing: "border-box",
        borderRadius: 18,
        overflow: "hidden",
        boxShadow: "0 22px 60px rgba(15, 23, 42, 0.16)",
      }}
    >
      <div style={{ height: 9, background: COLORS.gold }} />
      <header style={{ background: COLORS.navy, color: "#ffffff", padding: "24px 30px 22px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 15, minWidth: 0 }}>
          <div style={{ width: 58, height: 58, flex: "0 0 58px", borderRadius: 14, background: COLORS.gold, color: COLORS.navy, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19, fontWeight: 950, letterSpacing: "-0.04em" }}>SES</div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-0.025em" }}>Sunchaser Energy Systems</div>
            <div style={{ color: "#cbd5e1", fontSize: 10.5, lineHeight: 1.55, marginTop: 5 }}>
              ceo.sunchaser@gmail.com&nbsp;&nbsp;|&nbsp;&nbsp;www.sunchaserenergy.co<br />
              0330-7776444&nbsp;&nbsp;|&nbsp;&nbsp;0309-0236666
            </div>
          </div>
        </div>
        <div style={{ textAlign: "right", flex: "0 0 285px" }}>
          <div style={{ color: COLORS.gold, fontSize: 10, fontWeight: 900, letterSpacing: "0.18em" }}>TECHNICAL &amp; FINANCIAL BOQ</div>
          <div style={{ fontSize: 19, fontWeight: 900, marginTop: 7 }}>{calculation.systemCapacityKw} kW Hybrid Solar System</div>
          <div style={{ color: "#cbd5e1", fontSize: 10.5, marginTop: 7 }}>Quote {quoteNumber}&nbsp;&nbsp;|&nbsp;&nbsp;{date}</div>
        </div>
      </header>

      <div style={{ padding: "22px 30px 20px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: 10 }}>
          <DetailCard label="Prepared for" value={clientName.trim() || "Valued Client"} />
          <DetailCard label="Mobile number" value={clientPhone.trim() || "Not provided"} />
          <DetailCard label="Project city" value={clientCity.trim() || "Not provided"} />
        </div>

        <div style={{ marginTop: 14, border: `1px solid ${COLORS.line}`, borderRadius: 12, background: COLORS.panel, padding: "10px 12px", display: "grid", gridTemplateColumns: "1.15fr 1fr 1fr 1.2fr", gap: 5 }}>
          <EquipmentCard label="Solar array" value={`${config.panelQuantity} x ${calculation.panel.watts}W`} note={`${calculation.panel.brand} - ${calculation.configuredPanelCapacityKw.toFixed(2)} kW DC`} />
          <EquipmentCard label="Hybrid inverter" value={`${config.inverterQuantity} x ${calculation.inverter.capacityKw}kW`} note={calculation.inverter.brand} />
          <EquipmentCard label="Lithium storage" value={`${batteryQuantity} x ${calculation.battery.capacityKwh}kWh`} note={calculation.battery.brand} />
          <EquipmentCard label="Structure" value={calculation.structureLabel} note={`Capacity for ${calculation.configuredStructureCapacityPanels} panels`} />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "18px 0 9px" }}>
          <div style={{ width: 34, height: 4, borderRadius: 4, background: COLORS.gold }} />
          <div style={{ color: COLORS.navy, fontSize: 13, fontWeight: 900, letterSpacing: "0.04em", textTransform: "uppercase" }}>Bill of Quantities</div>
          <div style={{ height: 1, background: COLORS.line, flex: 1 }} />
        </div>

        <ProfessionalQuoteTable lines={calculation.lines} />

        <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end" }}>
          <div style={{ width: 350, borderRadius: 12, overflow: "hidden", border: `1px solid ${COLORS.navy}` }}>
            <div style={{ background: COLORS.navySoft, color: "#cbd5e1", padding: "7px 14px", fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase" }}>Complete system estimate</div>
            <div style={{ background: COLORS.navy, color: "#ffffff", padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
              <span style={{ fontSize: 12, fontWeight: 800 }}>Final estimated cost</span>
              <span style={{ color: COLORS.gold, fontSize: 21, fontWeight: 950, whiteSpace: "nowrap" }}>{currency(calculation.totalPkr)}</span>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div style={{ border: `1px solid #a7f3d0`, background: COLORS.greenSoft, borderRadius: 11, padding: "10px 12px" }}>
            <div style={{ color: COLORS.green, fontSize: 10, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase" }}>Included in this estimate</div>
            <div style={{ color: "#365147", fontSize: 9.5, lineHeight: 1.45, marginTop: 5 }}>Capacity-specific cabling, protection, accessories, earthing, installation, transport, testing and commissioning as listed above.</div>
          </div>
          <div style={{ border: `1px solid ${COLORS.line}`, background: COLORS.panel, borderRadius: 11, padding: "10px 12px" }}>
            <div style={{ color: COLORS.navy, fontSize: 10, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase" }}>Commercial notes</div>
            <div style={{ color: COLORS.muted, fontSize: 9.5, lineHeight: 1.45, marginTop: 5 }}>Estimate valid for 3 days and subject to site survey, stock availability and final technical approval. Unlisted civil work is excluded.</div>
          </div>
        </div>

        <footer style={{ marginTop: 15, borderTop: `1px solid ${COLORS.line}`, paddingTop: 10, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20 }}>
          <div style={{ color: COLORS.muted, fontSize: 9 }}>Professional solar design, installation and after-sales support.</div>
          <div style={{ color: COLORS.navy, fontSize: 9, fontWeight: 900 }}>SUNCHASER ENERGY SYSTEMS</div>
        </footer>
      </div>
    </div>
  );
}
