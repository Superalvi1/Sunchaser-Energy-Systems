/** Reviewed pilot acknowledgements. No prices, warranty or delivery promises. */
export function pilotLanguage(text) {
  if (/[\u0600-\u06ff]/u.test(String(text))) return "ur";
  if (/\b(aoa|salam|assalam|assalamu|alaikum|chahiye|hai|hain|kya|aap|mujhe|mera|meri|kitna|kitne|qeemat|batao|batayein|karna|karein|bhej|rabta)\b/i.test(String(text))) return "roman";
  return "en";
}
const COPY = {
  en: {
    welcome: "Welcome to Sunchaser Energy Systems. How can I help with your solar enquiry?",
    review: "Thank you for contacting Sunchaser Energy Systems. Your enquiry needs staff review. Please wait for our team to respond.",
    sales: "Please share your city and whether you need on-grid or hybrid solar. Your enquiry needs staff review to confirm a suitable system and current price.",
    service_area: "Sunchaser Energy Systems is based in Lahore. Please share your installation location so our team can confirm service availability."
  },
  roman: {
    welcome: "Assalam-o-Alaikum! Sunchaser Energy Systems mein khush aamdeed. Solar ke bare mein kya maloom karna chahte hain?",
    review: "Sunchaser se rabta karne ka shukriya. Is sawal par hamari team ka review zaroori hai. Bara-e-meherbani team ke jawab ka intezar karein.",
    sales: "Apni city aur on-grid ya hybrid ki zaroorat batayein. Munasib system aur aaj ki qeemat confirm karne ke liye hamari team ka review zaroori hai.",
    service_area: "Sunchaser Energy Systems Lahore mein hai. Installation ki location batayein taake hamari team service ki dastiyabi confirm kar sake."
  },
  ur: {
    welcome: "السلام علیکم! سن چیزر انرجی سسٹمز میں خوش آمدید۔ سولر کے بارے میں کیا جاننا چاہتے ہیں؟",
    review: "سن چیزر سے رابطہ کرنے کا شکریہ۔ اس سوال پر ہماری ٹیم کا جائزہ ضروری ہے۔ براہ کرم ٹیم کے جواب کا انتظار کریں۔",
    sales: "اپنا شہر اور آن گرڈ یا ہائبرڈ کی ضرورت بتائیں۔ مناسب سسٹم اور موجودہ قیمت کی تصدیق کے لیے ہماری ٹیم کا جائزہ ضروری ہے۔",
    service_area: "سن چیزر انرجی سسٹمز لاہور میں ہے۔ تنصیب کی جگہ بتائیں تاکہ ہماری ٹیم سروس کی دستیابی کی تصدیق کر سکے۔"
  }
};
export function pilotText(text, kind) { return COPY[pilotLanguage(text)][kind]; }
