from pathlib import Path
import re

pdf = Path('src/lib/quotePdfExport.ts')
s = pdf.read_text()
s = s.replace('import { Browser } from "@capacitor/browser";\n', '')
s = s.replace('  await Browser.open({ url });', '  window.location.assign(url);')
pdf.write_text(s)

# Update regression test to prove there is no native browser/file/share handoff in quotation PDF path.
test = Path('src/lib/quickQuotationMode.test.ts')
t = test.read_text()
t = t.replace('native PDF path uses one-time Browser handoff and no file/share bridge', 'native PDF path uses plain HTTPS navigation and no native plugin handoff')
t = t.replace('assert.match(pdf, /Browser\\.open/);', 'assert.match(pdf, /window\\.location\\.assign/);\n  assert.doesNotMatch(pdf, /Browser\\.open/);\n  assert.doesNotMatch(pdf, /@capacitor\\/browser/);')
test.write_text(t)

# Version bump for an unambiguous device test.
gradle = Path('android/app/build.gradle')
g = gradle.read_text().replace('versionCode 14', 'versionCode 15').replace('versionName "1.0.11"', 'versionName "1.0.12"')
gradle.write_text(g)
