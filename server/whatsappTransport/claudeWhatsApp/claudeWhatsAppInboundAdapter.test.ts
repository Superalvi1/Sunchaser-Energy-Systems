/**
 * Claude WhatsApp inbound adapter tests.
 * Confirms repository writes match the Meta webhook path for the same shape.
 * Run: npm run test:claude-whatsapp
 */
import assert from "node:assert/strict";
import { InMemoryWhatsAppRepository } from "../whatsappRepository.ts";
import {
  normalizeBaileysInboundMessage,
  persistClaudeWhatsAppInbound,
} from "./claudeWhatsAppInboundAdapter.ts";
import {
  CLAUDE_WHATSAPP_CHANNEL_PHONE_NUMBER_ID,
  CLAUDE_WHATSAPP_PROVIDER,
} from "./claudeWhatsAppConstants.ts";
import {
  ClaudeWhatsAppKillSwitch,
  resetClaudeWhatsAppKillSwitchForTests,
} from "./claudeWhatsAppKillSwitch.ts";
import {
  createClaudeWhatsAppOutboundPort,
  sendClaudeWhatsAppBroadcast,
} from "./claudeWhatsAppOutboundPort.ts";
import {
  ClaudeWhatsAppProvider,
  resetClaudeWhatsAppProviderForTests,
} from "./claudeWhatsAppProvider.ts";

let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`PASS: ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL: ${name}`, err);
  }
}

await test("normalizeBaileysInboundMessage maps text like Meta envelope", () => {
  const event = normalizeBaileysInboundMessage({
    key: {
      id: "BAILEYS1",
      remoteJid: "923001234567@s.whatsapp.net",
      fromMe: false,
    },
    message: { conversation: "Hello from Web" },
    messageTimestamp: 1700000000,
    pushName: "Ali",
  });
  assert.ok(event);
  assert.equal(event!.kind, "inbound_text");
  assert.equal(event!.fromWaId, "923001234567");
  assert.equal(event!.text, "Hello from Web");
  assert.equal(event!.phoneNumberId, CLAUDE_WHATSAPP_CHANNEL_PHONE_NUMBER_ID);
  assert.equal(event!.provider, CLAUDE_WHATSAPP_PROVIDER);
  assert.equal(event!.waMessageId, "claude_BAILEYS1");
  assert.equal(event!.profileName, "Ali");
});

await test("normalize skips fromMe and group JIDs", () => {
  assert.equal(
    normalizeBaileysInboundMessage({
      key: { id: "1", remoteJid: "x@s.whatsapp.net", fromMe: true },
      message: { conversation: "me" },
    }),
    null
  );
  assert.equal(
    normalizeBaileysInboundMessage({
      key: { id: "2", remoteJid: "120363@g.us", fromMe: false },
      message: { conversation: "group" },
    }),
    null
  );
});

await test(
  "persistClaudeWhatsAppInbound uses same resolveOrCreate* + insert sequence as webhook",
  async () => {
    const repo = new InMemoryWhatsAppRepository();
    const result = await persistClaudeWhatsAppInbound(
      {
        key: {
          id: "MSG99",
          remoteJid: "923009998887@s.whatsapp.net",
          fromMe: false,
        },
        message: { conversation: "Need a solar quote" },
        messageTimestamp: 1700000100,
        pushName: "Sara",
      },
      { repo }
    );
    assert.equal(result.ok, true);
    if (result.ok === false) return;

    assert.equal(repo.channels.size, 1);
    const channel = [...repo.channels.values()][0];
    assert.equal(channel.phoneNumberId, CLAUDE_WHATSAPP_CHANNEL_PHONE_NUMBER_ID);
    assert.equal(channel.wabaId, CLAUDE_WHATSAPP_PROVIDER);

    assert.equal(repo.contacts.size, 1);
    const contact = [...repo.contacts.values()][0];
    assert.equal(contact.phoneE164, "923009998887");
    assert.equal(contact.profileName, "Sara");

    assert.equal(repo.conversations.size, 1);
    const conversation = [...repo.conversations.values()][0];
    assert.equal(conversation.channelId, channel.id);
    assert.equal(conversation.contactId, contact.id);

    assert.equal(repo.messages.size, 1);
    const message = [...repo.messages.values()][0];
    assert.equal(message.conversationId, conversation.id);
    assert.equal(message.waMessageId, "claude_MSG99");
    assert.equal(message.textBody, "Need a solar quote");
    assert.equal(message.direction, "inbound");
    assert.equal(
      (message.rawPayload as { provider?: string }).provider,
      CLAUDE_WHATSAPP_PROVIDER
    );
    assert.equal(
      (message.rawMetadata as { provider?: string } | null)?.provider,
      CLAUDE_WHATSAPP_PROVIDER
    );

    const audits = repo.auditEvents.filter(
      (a) => a.eventType === "inbound_message_stored"
    );
    assert.equal(audits.length, 1);
    assert.equal(
      (audits[0].metadata as { provider?: string }).provider,
      CLAUDE_WHATSAPP_PROVIDER
    );
  }
);

await test(
  "persist is idempotent on duplicate waMessageId (same as webhook path)",
  async () => {
    const repo = new InMemoryWhatsAppRepository();
    const msg = {
      key: {
        id: "DUP1",
        remoteJid: "923001111111@s.whatsapp.net",
        fromMe: false,
      },
      message: { conversation: "once" },
      messageTimestamp: 1700000200,
    };
    const a = await persistClaudeWhatsAppInbound(msg, { repo });
    const b = await persistClaudeWhatsAppInbound(msg, { repo });
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    if (a.ok && b.ok) {
      assert.equal(a.created, true);
      assert.equal(b.created, false);
      assert.equal(a.messageId, b.messageId);
    }
    assert.equal(repo.messages.size, 1);
  }
);

await test("bulk/broadcast send is blocked at code level", () => {
  assert.throws(
    () =>
      sendClaudeWhatsAppBroadcast({
        recipients: ["923001234567", "923009998887"],
        text: "blast",
      }),
    /bulk\/broadcast send is blocked/
  );
});

await test(
  "kill switch OFF rejects outbound within the same refresh (no redeploy)",
  async () => {
    resetClaudeWhatsAppKillSwitchForTests();
    resetClaudeWhatsAppProviderForTests();
    const memory = { enabled: true };
    const killSwitch = new ClaudeWhatsAppKillSwitch({
      memoryStore: memory,
      pollMs: 50,
    });
    const repo = new InMemoryWhatsAppRepository();
    const channel = await repo.resolveOrCreateChannel({
      phoneNumberId: CLAUDE_WHATSAPP_CHANNEL_PHONE_NUMBER_ID,
      wabaId: CLAUDE_WHATSAPP_PROVIDER,
    });
    const contact = await repo.resolveOrCreateContact({
      phoneE164: "923001234567",
    });
    const conversation = await repo.resolveOrCreateOpenConversation({
      channelId: channel.id,
      contactId: contact.id,
    });

    let sent = 0;
    const provider = new ClaudeWhatsAppProvider({
      killSwitch,
      repo,
      autoReconnect: false,
      loadAuth: async () => ({
        state: { creds: {}, keys: { get: async () => ({}), set: async () => {} } },
        saveCreds: async () => {},
        clearSession: async () => {},
      }),
      makeSocket: async () => ({
        ev: { on: () => {} },
        sendMessage: async () => {
          sent += 1;
          return { key: { id: "OUT1" } };
        },
        user: { id: "923000000000:0@s.whatsapp.net" },
      }),
    });
    // Simulate connected state.
    (provider as unknown as { status: string; socket: unknown }).status =
      "connected";
    (provider as unknown as { socket: unknown }).socket = {
      sendMessage: async () => {
        sent += 1;
        return { key: { id: "OUT1" } };
      },
    };

    const port = createClaudeWhatsAppOutboundPort({
      repo,
      provider,
      killSwitch,
      minGapMs: 0,
      sleep: async () => {},
    });

    const actor = {
      id: "admin-1",
      role: "Admin",
      email: "admin@test",
    } as const;

    const ok = await port({
      conversationId: conversation.id,
      text: "hello",
      actor: actor as any,
    });
    assert.equal(ok.ok, true);
    assert.equal(sent, 1);

    // Abort without redeploy — next check sees OFF.
    memory.enabled = false;
    const t0 = Date.now();
    const blocked = await port({
      conversationId: conversation.id,
      text: "should fail",
      actor: actor as any,
    });
    const elapsed = Date.now() - t0;
    assert.equal(blocked.ok, false);
    if (blocked.ok === false) {
      assert.match(blocked.error, /kill switch|OFF/i);
    }
    assert.equal(sent, 1);
    assert.ok(
      elapsed < 3000,
      `kill switch should take effect in <3s, took ${elapsed}ms`
    );
  }
);

await test(
  "outbound enforces minimum per-conversation send gap",
  async () => {
    resetClaudeWhatsAppKillSwitchForTests();
    const memory = { enabled: true };
    const killSwitch = new ClaudeWhatsAppKillSwitch({ memoryStore: memory });
    const repo = new InMemoryWhatsAppRepository();
    const channel = await repo.resolveOrCreateChannel({
      phoneNumberId: CLAUDE_WHATSAPP_CHANNEL_PHONE_NUMBER_ID,
      wabaId: CLAUDE_WHATSAPP_PROVIDER,
    });
    const contact = await repo.resolveOrCreateContact({
      phoneE164: "923001234567",
    });
    const conversation = await repo.resolveOrCreateOpenConversation({
      channelId: channel.id,
      contactId: contact.id,
    });

    let clock = 1_000_000;
    const sleeps: number[] = [];
    const provider = new ClaudeWhatsAppProvider({
      killSwitch,
      repo,
      autoReconnect: false,
    });
    (provider as unknown as { status: string }).status = "connected";
    (provider as unknown as { socket: unknown }).socket = {
      sendMessage: async () => ({ key: { id: `S${sleeps.length}` } }),
    };

    const port = createClaudeWhatsAppOutboundPort({
      repo,
      provider,
      killSwitch,
      minGapMs: 1500,
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
    });

    const actor = { id: "a", role: "Admin", email: "a@t" } as any;
    const r1 = await port({
      conversationId: conversation.id,
      text: "one",
      actor,
    });
    assert.equal(r1.ok, true);
    // Second send immediately — must wait remaining gap.
    clock += 200;
    const r2 = await port({
      conversationId: conversation.id,
      text: "two",
      actor,
    });
    assert.equal(r2.ok, true);
    assert.ok(sleeps.length >= 1);
    assert.ok(sleeps[0]! >= 1300 && sleeps[0]! <= 1500);
  }
);

await test(
  "kill switch poll flips enabled within a few seconds without redeploy",
  async () => {
    resetClaudeWhatsAppKillSwitchForTests();
    const memory = { enabled: true };
    const flips: boolean[] = [];
    const killSwitch = new ClaudeWhatsAppKillSwitch({
      memoryStore: memory,
      pollMs: 100,
      onChange: (v) => flips.push(v),
    });
    killSwitch.start();
    assert.equal(await killSwitch.refresh(), true);
    memory.enabled = false;
    const deadline = Date.now() + 2500;
    while (killSwitch.isEnabled() && Date.now() < deadline) {
      await killSwitch.refresh();
      await new Promise((r) => setTimeout(r, 50));
    }
    killSwitch.stop();
    assert.equal(killSwitch.isEnabled(), false);
    assert.ok(
      Date.now() <= deadline,
      "kill switch did not flip within 2.5s"
    );
  }
);

if (failed > 0) {
  console.error(`\n${failed} Claude WhatsApp test(s) failed`);
  process.exit(1);
}
console.log("\nAll Claude WhatsApp tests passed");
