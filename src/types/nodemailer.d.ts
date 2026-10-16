// Deklarasi minimal untuk nodemailer (yang dipakai src/lib/email-notify.ts),
// supaya tidak perlu @types/nodemailer yang ikut menarik paket AWS SES.
declare module 'nodemailer' {
  export interface SendMailOptions {
    from?: string;
    to?: string;
    subject?: string;
    text?: string;
    html?: string;
  }
  export interface Transporter {
    sendMail(options: SendMailOptions): Promise<{ messageId: string }>;
    verify(): Promise<true>;
  }
  export interface TransportOptions {
    host?: string;
    port?: number;
    secure?: boolean;
    auth?: { user: string; pass: string };
  }
  export function createTransport(options: TransportOptions): Transporter;
  const nodemailer: { createTransport: typeof createTransport };
  export default nodemailer;
}
