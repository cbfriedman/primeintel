import { Resend } from 'resend';

export function getResendClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    throw new Error('Missing RESEND_API_KEY environment variable.');
  }

  return new Resend(apiKey);
}

export function getResendFromAddress(): string {
  const from = process.env.RESEND_FROM_EMAIL;

  if (!from) {
    throw new Error('Missing RESEND_FROM_EMAIL environment variable.');
  }

  return from;
}
