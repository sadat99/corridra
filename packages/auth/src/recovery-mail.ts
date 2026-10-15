import { z } from 'zod';

export type PasswordRecoveryMail = { email: string; url: string };

// Identity mail is separate from mission communications and never enables outreach.
export function operatorRecoveryMailer(env: NodeJS.ProcessEnv = process.env) {
  if (env.CORRIDRA_OPERATOR_RECOVERY_ENABLED !== 'true') return undefined;
  const config = z
    .object({
      APP_ORIGIN: z.url(),
      OPERATOR_RECOVERY_EMAIL_KEY: z.string().min(16),
      OPERATOR_RECOVERY_EMAIL_FROM: z.email(),
    })
    .safeParse(env);
  if (!config.success) return undefined;
  const { APP_ORIGIN, OPERATOR_RECOVERY_EMAIL_KEY, OPERATOR_RECOVERY_EMAIL_FROM } = config.data;
  return async ({ email, url }: PasswordRecoveryMail) => {
    const target = new URL(url);
    if (
      target.origin !== new URL(APP_ORIGIN).origin ||
      !/^\/api\/operator-auth\/reset-password\/[A-Za-z0-9]{24}$/.test(target.pathname) ||
      target.searchParams.get('callbackURL') !==
        new URL('/operator/reset-password', APP_ORIGIN).href
    )
      throw new Error('Invalid operator recovery destination');
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPERATOR_RECOVERY_EMAIL_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `Corridra <${OPERATOR_RECOVERY_EMAIL_FROM}>`,
        to: [z.email().parse(email)],
        subject: 'Reset your Corridra operator password',
        text: `A password reset was requested for your Corridra operator account.\n\n${url}\n\nThis link expires in 30 minutes and can be used once. Your authenticator is still required. This does not change your customer account password or workspace permissions. If you did not request this, ignore this email.`,
      }),
      signal: AbortSignal.timeout(15000),
    });
    // Provider response bodies can contain private addresses. Never log or return them.
    if (!response.ok) throw new Error('Operator recovery email is temporarily unavailable');
  };
}
