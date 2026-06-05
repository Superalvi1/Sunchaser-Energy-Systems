const ones = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function underThousand(n: number): string {
  if (n === 0) return "";
  if (n < 20) return ones[n];
  if (n < 100) {
    const t = Math.floor(n / 10);
    const o = n % 10;
    return tens[t] + (o ? " " + ones[o] : "");
  }
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return ones[h] + " Hundred" + (rest ? " " + underThousand(rest) : "");
}

function chunkToWords(n: number, label: string): string {
  if (!n) return "";
  return underThousand(n).trim() + " " + label;
}

/** Pakistani Rupees amount in words (integer rupees). */
export function amountInWordsPkr(amount: number): string {
  const n = Math.round(Math.abs(Number(amount) || 0));
  if (n === 0) return "Zero Rupees only";

  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const remainder = n % 1000;

  const parts: string[] = [];
  if (crore) parts.push(chunkToWords(crore, "Crore"));
  if (lakh) parts.push(chunkToWords(lakh, "Lakh"));
  if (thousand) parts.push(chunkToWords(thousand, "Thousand"));
  if (remainder) parts.push(underThousand(remainder));

  const words = parts.join(" ").replace(/\s+/g, " ").trim();
  return `${words} Rupees only`;
}
