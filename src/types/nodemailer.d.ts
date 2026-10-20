// Deklarasi minimal untuk nodemailer (yang dipakai src/lib/email-notify.ts),
// supaya tidak perlu @types/nodemailer yang ikut menarik paket AWS SES.
declare module 'nodemailer' {
  export type Address = string | { name: string; address: string };
  export interface Attachment {
    filename?: string;
    content?: string | Buffer;
    contentType?: string;
    /** Content-ID untuk gambar sisipan (<img src="cid:...">). */
    cid?: string;
  }
  export interface SendMailOptions {
    from?: Address;
    to?: string | string[];
    cc?: string | string[];
    replyTo?: string;
    subject?: string;
    text?: string;
    html?: string;
    attachments?: Attachment[];
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
