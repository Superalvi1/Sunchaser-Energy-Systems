import urllib.request
import urllib.error
import json

url = "http://localhost:3000/api/export/pdf/manual-quote"

payload = {
    "clientName": "Test Client",
    "boqRows": [
        {"id": "manual-row-1", "type": "item", "name": "Custom Manual Item", "description": "Custom Description", "qty": 1, "unit": "Nos", "rate": 5000, "total": 5000},
        {"id": "panel_row", "type": "item", "name": "AI Solar Panels", "description": "Sizer panels", "qty": 10, "unit": "Nos", "rate": 10000, "total": 100000}
    ],
    "includeSizerItems": False,
    "includedPages": ["cover", "profile", "qr", "ceo", "structure", "boq", "terms", "signoff", "bank", "final"]
}

def make_request(include_sizer):
    payload["includeSizerItems"] = include_sizer
    data = json.dumps({"payload": json.dumps(payload)}).encode('utf-8')
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req) as res:
            return res.status, res.read().decode('utf-8')
    except urllib.error.HTTPError as e:
        print("HTTP Error:", e.code, e.reason)
        return e.code, e.read().decode('utf-8')
    except Exception as e:
        print("Request failed:", e)
        return None, None

status_false, html_false = make_request(False)
print("includeSizerItems=False:")
print("Custom Manual Item in HTML?", "Custom Manual Item" in html_false)
print("AI Solar Panels in HTML?", "AI Solar Panels" in html_false)

status_true, html_true = make_request(True)
print("includeSizerItems=True:")
print("Custom Manual Item in HTML?", "Custom Manual Item" in html_true)
print("AI Solar Panels in HTML?", "AI Solar Panels" in html_true)
