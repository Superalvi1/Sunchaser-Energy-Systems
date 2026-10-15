import { Router } from 'express';
import { canManageAutoSizerPresets } from '../../src/lib/roles';
import { validateSmartQuoteSettings, type SmartQuoteSettings } from '../../src/lib/smartQuoteSettings';
import { SmartQuoteSettingsConflict } from './settingsStore';

export function createSmartQuoteSettingsRouter(store: { read: () => Promise<SmartQuoteSettings>; save: (input: unknown) => Promise<SmartQuoteSettings> }) {
  const router = Router();
  // Only the selling catalogue and document text are exposed, never global CRM settings.
  router.get('/api/public/smart-quote-settings', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try { res.json({ settings: await store.read() }); }
    catch { res.status(503).json({ error: 'Current quotation prices are unavailable. Please retry.' }); }
  });
  router.use('/api/admin/smart-quote-settings', (req, res, next) => {
    if (!req.actor) return res.status(401).json({ error: 'Unauthorized' });
    if (!canManageAutoSizerPresets(req.actor.username, req.actor.role)) return res.status(403).json({ error: 'Quotation administration access is required.' });
    next();
  });
  router.get('/api/admin/smart-quote-settings', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try { res.json({ settings: await store.read() }); }
    catch { res.status(503).json({ error: 'Could not load Smart Quote prices.' }); }
  });
  router.put('/api/admin/smart-quote-settings', async (req, res) => {
    let draft: SmartQuoteSettings;
    try { draft = validateSmartQuoteSettings(req.body); }
    catch (e) { return res.status(400).json({ error: (e as Error).message }); }
    try { res.json({ settings: await store.save(draft) }); }
    catch (e) {
      if (e instanceof SmartQuoteSettingsConflict) return res.status(409).json({ error: e.message });
      res.status(503).json({ error: 'Could not save Smart Quote prices. Please retry.' });
    }
  });
  return router;
}
