import { NextRequest } from 'next/server';

import { createLearningUser, isDuplicateEmailError } from '@/lib/server/learning-auth-db';
import {
  assertSameOrigin,
  authenticatedRedirect,
  authErrorRedirect,
} from '@/lib/server/learning-auth-http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const displayName = String(form.get('displayName') || '').trim();
  const email = String(form.get('email') || '').trim().toLowerCase();
  const password = String(form.get('password') || '');
  const confirmPassword = String(form.get('confirmPassword') || '');
  const next = form.get('next');

  try {
    assertSameOrigin(req);
    if (displayName.length < 2 || displayName.length > 80) {
      return authErrorRedirect(req, 'register', 'name', next);
    }
    if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
      return authErrorRedirect(req, 'register', 'email', next);
    }
    if (password.length < 8 || password.length > 128) {
      return authErrorRedirect(req, 'register', 'password', next);
    }
    if (password !== confirmPassword) {
      return authErrorRedirect(req, 'register', 'confirm', next);
    }

    const identity = await createLearningUser({ displayName, email, password });
    return authenticatedRedirect(req, identity, next);
  } catch (error) {
    if (isDuplicateEmailError(error)) {
      return authErrorRedirect(req, 'register', 'exists', next);
    }
    console.error('Learning Studio registration failed', error);
    return authErrorRedirect(req, 'register', 'unavailable', next);
  }
}
