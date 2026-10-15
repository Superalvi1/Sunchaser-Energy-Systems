import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyRelaySignature, validRelayEvent } from '../src/signature.mjs';

const secret = 'test-relay-secret';
const sign = (raw) => 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');

test('valid relay signature verifies', () => {
  const raw = JSON.stringify({ messageId: 'wamid.1' });
  assert.equal(verifyRelaySignature(raw, sign(raw), secret), true);
});

test('wrong signature or secret rejects', () => {
  const raw = JSON.stringify({ messageId: 'wamid.1' });
  assert.equal(verifyRelaySignature(raw, sign(raw), 'other-secret'), false);
  assert.equal(verifyRelaySignature(raw, 'sha256=deadbeef', secret), false);
  assert.equal(verifyRelaySignature(raw, null, secret), false);
});

test('tampered body rejects', () => {
  const raw = JSON.stringify({ messageId: 'wamid.1' });
  const tampered = JSON.stringify({ messageId: 'wamid.2' });
  assert.equal(verifyRelaySignature(tampered, sign(raw), secret), false);
});

test('valid relay event shape passes', () => {
  assert.equal(validRelayEvent({
    conversationId: 'conv-1',
    messageId: 'wamid.HBgMNTIz',
    phone: '923001111111',
    phoneNumberId: '243825222156651',
    type: 'text',
    text: 'hello',
    sentAt: Date.now(),
  }), true);
});

test('relay event rejects bad wamid, phone, number id, or future skew', () => {
  const base = {
    conversationId: 'conv-1',
    messageId: 'wamid.1',
    phone: '923001111111',
    phoneNumberId: '243825222156651',
    type: 'text',
    text: 'hi',
    sentAt: Date.now(),
  };
  assert.equal(validRelayEvent({ ...base, messageId: 'nope' }), false);
  assert.equal(validRelayEvent({ ...base, phone: 'abc' }), false);
  assert.equal(validRelayEvent({ ...base, phoneNumberId: '12ab' }), false);
  assert.equal(validRelayEvent({ ...base, type: 'image' }), false);
  assert.equal(validRelayEvent({ ...base, sentAt: Date.now() + 600000 }), false);
  assert.equal(validRelayEvent({ ...base, conversationId: '' }), false);
});
