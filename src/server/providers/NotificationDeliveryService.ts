/**
 * Real Provider-Backed Dispatch for Email, SMS, and WhatsApp Verification Codes.
 *
 * Configured via server-side environment variables:
 * - Email: EMAIL_PROVIDER_API_KEY, EMAIL_FROM
 * - SMS: SMS_PROVIDER_ACCOUNT_ID, SMS_PROVIDER_AUTH_TOKEN, SMS_PROVIDER_FROM
 * - WhatsApp: WHATSAPP_PROVIDER_ACCOUNT_ID, WHATSAPP_PROVIDER_AUTH_TOKEN, WHATSAPP_PROVIDER_FROM
 *
 * Does not silently fake successful delivery when credentials are missing.
 */

export interface MessageDispatchResult {
  success: boolean;
  channel: 'email' | 'sms' | 'whatsapp';
  destination: string;
  providerId?: string;
  error?: string;
}

export class NotificationDeliveryService {
  /**
   * Dispatch verification code to an email address via configured provider.
   */
  public async sendEmailVerification(
    email: string,
    code: string
  ): Promise<MessageDispatchResult> {
    const apiKey = process.env.EMAIL_PROVIDER_API_KEY?.trim();
    const fromAddress = process.env.EMAIL_FROM?.trim() || 'no-reply@rare-erudite.com';

    if (!apiKey) {
      return {
        success: false,
        channel: 'email',
        destination: email,
        error:
          'Email delivery provider is not configured. Missing server-side environment variable EMAIL_PROVIDER_API_KEY.',
      };
    }

    try {
      // Real standard transactional email dispatch (SendGrid / Resend / Mailgun compatible REST protocol)
      // Check for Resend vs SendGrid style endpoints based on API key prefix or standard headers
      const isResend = apiKey.startsWith('re_');
      const endpoint = isResend
        ? 'https://api.resend.com/emails'
        : 'https://api.sendgrid.com/v3/mail/send';

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      };

      const body = isResend
        ? JSON.stringify({
            from: fromAddress,
            to: [email],
            subject: 'Your RARE Security Verification Code',
            text: `Your RARE verification code is: ${code}. It expires in 10 minutes. Do not share this code with anyone.`,
          })
        : JSON.stringify({
            personalizations: [{ to: [{ email }] }],
            from: { email: fromAddress, name: 'RARE Security' },
            subject: 'Your RARE Security Verification Code',
            content: [
              {
                type: 'text/plain',
                value: `Your RARE verification code is: ${code}. It expires in 10 minutes. Do not share this code with anyone.`,
              },
            ],
          });

      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        return {
          success: false,
          channel: 'email',
          destination: email,
          error: `Email provider rejected delivery (HTTP ${response.status}): ${errorText.slice(0, 200)}`,
        };
      }

      return {
        success: true,
        channel: 'email',
        destination: email,
        providerId: isResend ? 'resend' : 'sendgrid',
      };
    } catch (err: any) {
      return {
        success: false,
        channel: 'email',
        destination: email,
        error: `Email delivery dispatch failed: ${err.message}`,
      };
    }
  }

  /**
   * Dispatch verification code via SMS.
   */
  public async sendSmsVerification(
    phone: string,
    code: string
  ): Promise<MessageDispatchResult> {
    const accountSid = process.env.SMS_PROVIDER_ACCOUNT_ID?.trim();
    const authToken = process.env.SMS_PROVIDER_AUTH_TOKEN?.trim();
    const fromNumber = process.env.SMS_PROVIDER_FROM?.trim();

    if (!accountSid || !authToken || !fromNumber) {
      return {
        success: false,
        channel: 'sms',
        destination: phone,
        error:
          'SMS provider is not configured. Missing required server-side environment variables: SMS_PROVIDER_ACCOUNT_ID, SMS_PROVIDER_AUTH_TOKEN, SMS_PROVIDER_FROM.',
      };
    }

    try {
      const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
      const authHeader = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

      const params = new URLSearchParams();
      params.append('To', phone);
      params.append('From', fromNumber);
      params.append('Body', `Your RARE verification code is: ${code}. It expires in 10 minutes.`);

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${authHeader}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        return {
          success: false,
          channel: 'sms',
          destination: phone,
          error: `SMS provider rejected message (HTTP ${response.status}): ${errorText.slice(0, 200)}`,
        };
      }

      return {
        success: true,
        channel: 'sms',
        destination: phone,
        providerId: 'twilio-sms',
      };
    } catch (err: any) {
      return {
        success: false,
        channel: 'sms',
        destination: phone,
        error: `SMS delivery dispatch failed: ${err.message}`,
      };
    }
  }

  /**
   * Dispatch verification code via WhatsApp.
   */
  public async sendWhatsAppVerification(
    phone: string,
    code: string
  ): Promise<MessageDispatchResult> {
    const accountSid =
      process.env.WHATSAPP_PROVIDER_ACCOUNT_ID?.trim() ||
      process.env.SMS_PROVIDER_ACCOUNT_ID?.trim();
    const authToken =
      process.env.WHATSAPP_PROVIDER_AUTH_TOKEN?.trim() ||
      process.env.SMS_PROVIDER_AUTH_TOKEN?.trim();
    const fromNumber =
      process.env.WHATSAPP_PROVIDER_FROM?.trim() ||
      process.env.SMS_PROVIDER_FROM?.trim();

    if (!accountSid || !authToken || !fromNumber) {
      return {
        success: false,
        channel: 'whatsapp',
        destination: phone,
        error:
          'WhatsApp provider is not configured. Missing required server-side environment variables: WHATSAPP_PROVIDER_ACCOUNT_ID, WHATSAPP_PROVIDER_AUTH_TOKEN, WHATSAPP_PROVIDER_FROM.',
      };
    }

    try {
      const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
      const authHeader = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

      const toFormatted = phone.startsWith('whatsapp:') ? phone : `whatsapp:${phone}`;
      const fromFormatted = fromNumber.startsWith('whatsapp:') ? fromNumber : `whatsapp:${fromNumber}`;

      const params = new URLSearchParams();
      params.append('To', toFormatted);
      params.append('From', fromFormatted);
      params.append('Body', `Your RARE verification code is: ${code}. It expires in 10 minutes.`);

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${authHeader}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        return {
          success: false,
          channel: 'whatsapp',
          destination: phone,
          error: `WhatsApp provider rejected message (HTTP ${response.status}): ${errorText.slice(0, 200)}`,
        };
      }

      return {
        success: true,
        channel: 'whatsapp',
        destination: phone,
        providerId: 'twilio-whatsapp',
      };
    } catch (err: any) {
      return {
        success: false,
        channel: 'whatsapp',
        destination: phone,
        error: `WhatsApp delivery dispatch failed: ${err.message}`,
      };
    }
  }
}

export const notificationDeliveryService = new NotificationDeliveryService();
